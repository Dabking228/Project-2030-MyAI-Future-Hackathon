"""
setup_rag_corpus.py
--------------------
One-time script to:
1. Upload all RAG knowledge base documents to a GCS bucket
2. Create a Vertex AI RAG Engine corpus
3. Import all documents from GCS into the corpus
4. Print the corpus resource name to paste into genkit.ts

Prerequisites:
    pip install google-cloud-aiplatform google-cloud-storage

Authentication:
    gcloud auth application-default login
    gcloud config set project YOUR_PROJECT_ID

Run:
    python rag_data/setup_rag_corpus.py
"""

import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from AI_Agent/.env
env_path = Path(".") / "AI_Agent" / ".env"
load_dotenv(dotenv_path=env_path)
# Fallback to functions/.env if needed
if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
    load_dotenv(dotenv_path=Path(".") / "AI_Agent" / "functions" / ".env")

# ------------------------------------------------------------------ #
#  Configuration — update these                                       #
# ------------------------------------------------------------------ #

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
BUCKET_NAME = f"{PROJECT_ID}-sybarai-rag-docs"  # will be created if absent
CORPUS_NAME = "sybarai-transit-knowledge"

# All documents in the rag_data/ folder to upload
DOCUMENTS = [
    "rag_data/fare-rules.md",
    "rag_data/fares-rapidkl-rail.md",
    "rag_data/fares-rapidkl-passes.md",
    "rag_data/fares-rapidkl-bus.md",
    "rag_data/interchange-guides.md",
    "rag_data/stop-aliases.md",  # generate with generate_stop_aliases.py first
    "rag_data/service-policies.md",
    "rag_data/carbon-methodology.md",  # generate with generate_carbon_doc.py first
]

# ------------------------------------------------------------------ #
#  Validate                                                           #
# ------------------------------------------------------------------ #

if not PROJECT_ID:
    sys.exit("ERROR: GOOGLE_CLOUD_PROJECT environment variable is not set.")

missing = [d for d in DOCUMENTS if not os.path.exists(d)]
if missing:
    print(f"WARNING: These documents don't exist yet (generate them first):")
    for m in missing:
        print(f"  {m}")
    print()

# ------------------------------------------------------------------ #
#  Step 1: Upload documents to GCS                                    #
# ------------------------------------------------------------------ #

from google.cloud import storage


def upload_to_gcs(bucket_name: str, docs: list[str]) -> list[str]:
    """Upload documents to GCS and return their gs:// URIs."""
    client = storage.Client(project=PROJECT_ID)

    # Create bucket if it doesn't exist
    try:
        bucket = client.get_bucket(bucket_name)
        print(f"Using existing bucket: gs://{bucket_name}")
    except Exception:
        bucket = client.create_bucket(bucket_name, location=LOCATION)
        print(f"Created bucket: gs://{bucket_name}")

    gcs_uris = []
    for doc_path in docs:
        if not os.path.exists(doc_path):
            print(f"  SKIP: {doc_path} (file not found)")
            continue

        blob_name = os.path.basename(doc_path)
        blob = bucket.blob(f"knowledge-base/{blob_name}")
        blob.upload_from_filename(doc_path, content_type="text/plain; charset=utf-8")
        uri = f"gs://{bucket_name}/knowledge-base/{blob_name}"
        gcs_uris.append(uri)
        print(f"  Uploaded: {uri}")

    return gcs_uris


print("=" * 60)
print("Step 1: Uploading documents to GCS")
print("=" * 60)
gcs_uris = upload_to_gcs(BUCKET_NAME, DOCUMENTS)
print(f"\nUploaded {len(gcs_uris)} documents.\n")

# ------------------------------------------------------------------ #
#  Step 2: Create RAG corpus                                          #
# ------------------------------------------------------------------ #

import vertexai
from vertexai.preview import rag

vertexai.init(project=PROJECT_ID, location=LOCATION)

print("=" * 60)
print("Step 2: Creating Vertex AI RAG corpus")
print("=" * 60)

# Check if corpus already exists
existing_corpora = rag.list_corpora()
corpus = None
for c in existing_corpora:
    if c.display_name == CORPUS_NAME:
        corpus = c
        print(f"Using existing corpus: {corpus.name}")
        break

if corpus is None:
    embedding_model_config = rag.RagEmbeddingModelConfig(
        vertex_prediction_endpoint=f"projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/text-embedding-004"
    )

    corpus = rag.create_corpus(
        display_name=CORPUS_NAME,
        description=(
            "Malaysian public transport knowledge base for SYBAR_AI app. "
            "Contains fare rules, interchange guides, stop name aliases, "
            "service policies, and carbon emission methodology for "
            "KTMB, Prasarana (LRT/MRT/Monorail), and BAS.MY bus operators."
        ),
        embedding_model_config=embedding_model_config,
        vector_db=rag.RagManagedDb(),
    )
    print(f"Created corpus: {corpus.name}")

print()

# ------------------------------------------------------------------ #
#  Step 3: Import documents into corpus                               #
# ------------------------------------------------------------------ #

if gcs_uris:
    print("=" * 60)
    print("Step 3: Importing documents into RAG corpus")
    print("=" * 60)

    response = rag.import_files(
        corpus_name=corpus.name,
        paths=gcs_uris,
        transformation_config=rag.TransformationConfig(
            chunking_config=rag.ChunkingConfig(
                chunk_size=512,
                chunk_overlap=100,
            ),
        ),
        max_embedding_requests_per_min=1000,
    )
    print(f"Import complete: {response}")
    print()

# ------------------------------------------------------------------ #
#  Step 4: Print corpus resource name for genkit.ts                   #
# ------------------------------------------------------------------ #

print("=" * 60)
print("SUCCESS — Corpus resource name:")
print("=" * 60)
print()
print(f"  {corpus.name}")
print()
print("Add this to your AI_Agent/.env:")
print(f"  RAG_CORPUS_NAME={corpus.name}")
print()
print("And update AI_Agent/src/genkit.ts vertexRetrieval config with this name.")
print("=" * 60)
