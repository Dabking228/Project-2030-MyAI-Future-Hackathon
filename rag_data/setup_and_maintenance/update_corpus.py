"""
update_corpus.py
----------------
Run this whenever you update any .md document in rag_data/.
It re-uploads the changed files to GCS and re-imports them into
the existing Vertex AI RAG corpus.

This is NOT the same as setup_rag_corpus.py:
  - setup_rag_corpus.py  → creates the corpus (run ONCE)
  - update_corpus.py     → refreshes documents (run when content changes)

Usage:
    # Update all documents
    python rag_data/update_corpus.py

    # Update specific files only
    python rag_data/update_corpus.py --files fare-rules.md service-policies.md

Run from the project root directory.
"""

import argparse
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from AI_Agent/.env
env_path = Path(".") / "AI_Agent" / ".env"
load_dotenv(dotenv_path=env_path)
# Fallback to functions/.env if needed
if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
    load_dotenv(dotenv_path=Path(".") / "AI_Agent" / "functions" / ".env")

import vertexai
from google.cloud import storage
from vertexai.preview import rag

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
BUCKET_NAME = f"{PROJECT_ID}-sybarai-rag-docs"
CORPUS_NAME = os.environ.get("RAG_CORPUS_NAME", "")

ALL_DOCUMENTS = [
    "rag_data/fare-rules.md",
    "rag_data/fares-rapidkl-rail.md",
    "rag_data/fares-rapidkl-passes.md",
    "rag_data/fares-rapidkl-bus.md",
    "rag_data/interchange-guides.md",
    "rag_data/stop-aliases.md",
    "rag_data/service-policies.md",
    "rag_data/carbon-methodology.md",
]

if not PROJECT_ID:
    sys.exit("ERROR: GOOGLE_CLOUD_PROJECT environment variable is not set.")
if not CORPUS_NAME:
    sys.exit(
        "ERROR: RAG_CORPUS_NAME is not set.\n"
        "Run rag_data/setup_rag_corpus.py first to create the corpus,\n"
        "then set RAG_CORPUS_NAME in your .env file."
    )

# Parse optional --files argument
parser = argparse.ArgumentParser()
parser.add_argument(
    "--files", nargs="+", help="Specific filenames to update (e.g. fare-rules.md)"
)
args = parser.parse_args()

if args.files:
    docs_to_update = [
        f"rag_data/{f}" if not f.startswith("rag_data/") else f for f in args.files
    ]
else:
    docs_to_update = ALL_DOCUMENTS

missing = [d for d in docs_to_update if not os.path.exists(d)]
if missing:
    sys.exit(
        f"ERROR: Files not found: {missing}\nRun generation scripts first if needed."
    )

# ── Step 1: Upload to GCS ──────────────────────────────────────────
print(
    f"Uploading {len(docs_to_update)} file(s) to gs://{BUCKET_NAME}/knowledge-base/..."
)
gcs_client = storage.Client(project=PROJECT_ID)
bucket = gcs_client.bucket(BUCKET_NAME)
gcs_uris = []

for doc_path in docs_to_update:
    blob_name = os.path.basename(doc_path)
    blob = bucket.blob(f"knowledge-base/{blob_name}")
    blob.upload_from_filename(doc_path, content_type="text/plain; charset=utf-8")
    uri = f"gs://{BUCKET_NAME}/knowledge-base/{blob_name}"
    gcs_uris.append(uri)
    print(f"  ✓ {uri}")

# ── Step 2: Re-import into RAG corpus ─────────────────────────────
print(f"\nImporting into corpus: {CORPUS_NAME}")
vertexai.init(project=PROJECT_ID, location=LOCATION)

response = rag.import_files(
    corpus_name=CORPUS_NAME,
    paths=gcs_uris,
    transformation_config=rag.TransformationConfig(
        chunking_config=rag.ChunkingConfig(
            chunk_size=512,
            chunk_overlap=100,
        ),
    ),
    max_embedding_requests_per_min=1000,
)

print(f"\n✓ Import complete: {response}")
print(f"\nCorpus updated successfully. Changes will be live immediately.")
