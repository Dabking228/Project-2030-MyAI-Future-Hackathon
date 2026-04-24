"""
generate_stop_aliases.py
------------------------
Auto-generates stop-aliases.md from all Malaysian GTFS static feeds.

This script:
1. Downloads every GTFS static feed
2. Parses stops.txt from each
3. Generates normalised alias pairs (official → colloquial variants)
4. Outputs a Markdown document ready to upload to GCS for RAG ingestion

Run from the project root:
    python rag_data/setup_and_maintenance/generate_stop_aliases.py

Output: rag_data/stop-aliases.md
"""

import asyncio
import io
import re
import zipfile
from collections import defaultdict
from typing import List, Tuple

import httpx
import pandas as pd

FEEDS = [
    (
        "ktmb",
        "https://api.data.gov.my/gtfs-static/ktmb"
    ),
    (
        "rapid-rail-kl",
        "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",
    ),
    (
        "rapid-bus-kl",
        "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl",
    ),
    (
        "mybas-johor",
        "https://api.data.gov.my/gtfs-static/mybas-johor"
    ),
    (
        "mybas-melaka",
        "https://api.data.gov.my/gtfs-static/mybas-melaka"
    ),
    (
        "mybas-ipoh",
        "https://api.data.gov.my/gtfs-static/mybas-ipoh"
    ),
    (
        "mybas-seremban-a",
        "https://api.data.gov.my/gtfs-static/mybas-seremban-a"
    ),
]

# Manual alias overrides — official GTFS name → list of common aliases
# Add more as you discover them from user testing
MANUAL_ALIASES: dict[str, List[str]] = {
    "Kuala Lumpur Sentral": [
        "KL Sentral",
        "KL Central",
        "KL Sentral Station",
        "Sentral",
    ],
    "KLCC": ["Petronas", "Petronas Towers", "Twin Towers", "Suria KLCC"],
    "Bukit Bintang": ["BB", "Bintang Walk", "Pavilion area"],
    "Masjid Jamek": ["Jamek", "MJ"],
    "Dang Wangi": ["Dang Wangi LRT", "Near Berjaya Times Square area"],
    "Pasar Seni": ["Central Market LRT", "Pasar Seni LRT"],
    "Titiwangsa": ["Titiwangsa interchange"],
    "Bangsar": ["Bangsar LRT"],
    "Universiti": ["UM", "University Malaya", "Universiti LRT"],
    "Kelana Jaya": ["Kelana Jaya LRT", "KJ"],
    "Subang Jaya": ["Subang KTM", "Subang Jaya KTM"],
    "Shah Alam": ["Shah Alam KTM"],
    "Batu Caves": ["Batu Caves KTM", "Gua Batu"],
    "Chan Sow Lin": [
        "CSL",
        "Chan Sow Lin interchange",
        "Chan Sow Lin LRT",
        "Chan Sow Lin MRT",
    ],
    "Pudu": ["Pudu Sentral", "Puduraya"],
    "Terminal Bersepadu Selatan": [
        "TBS",
        "TBS bus terminal",
        "Bandar Tasik Selatan bus",
    ],
    "Putrajaya Sentral": ["Putrajaya", "Putrajaya KTM", "Putrajaya ERL"],
    "KLIA": ["Kuala Lumpur International Airport", "Airport KL"],
    "KLIA2": ["klia2", "Low Cost Carrier Terminal", "LCCT replacement"],
    "Mid Valley": ["Mid Valley KTM", "Mid Valley Megamall"],
    "Petaling Jaya Sentral": ["PJ Sentral", "PJS"],
    "Rawang": ["Rawang KTM"],
    "Ampang": ["Ampang LRT"],
    "Ampang Park": ["Ampang Park LRT", "Ampang Park MRT"],
}

def normalise_name(name: str) -> List[str]:
    """Generate common normalisation variants of a stop name."""
    aliases = set()
    aliases.add(name)

    # Remove common suffixes
    for suffix in [" Station", " LRT", " MRT", " KTM", " Sentral", " Interchange"]:
        if name.endswith(suffix):
            aliases.add(name[: -len(suffix)].strip())

    # Handle abbreviations like "KL" ↔ "Kuala Lumpur"
    expanded = re.sub(r"\bKL\b", "Kuala Lumpur", name)
    if expanded != name:
        aliases.add(expanded)

    # Uppercase common abbreviations
    upper = re.sub(r"\bMrt\b", "MRT", re.sub(r"\bLrt\b", "LRT", name))
    if upper != name:
        aliases.add(upper)

    return sorted(aliases - {name})

async def fetch_stops(name: str, url: str) -> pd.DataFrame:
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
            with zf.open("stops.txt") as f:
                df = pd.read_csv(f, dtype=str, low_memory=False)
                df["feed"] = name
                return df[["stop_id", "stop_name", "feed"]].dropna()
    except Exception as e:
        print(f"  WARNING: failed to fetch {name}: {e}")
        return pd.DataFrame()

async def main():
    print("Fetching GTFS stops from all feeds...")
    dfs = await asyncio.gather(*[fetch_stops(n, u) for n, u in FEEDS])
    all_stops = pd.concat(dfs, ignore_index=True)
    print(f"Total stops fetched: {len(all_stops)}")

    # Deduplicate by stop_name (case-insensitive)
    all_stops["stop_name_lower"] = all_stops["stop_name"].str.strip().str.lower()
    unique_names = (
        all_stops.drop_duplicates("stop_name_lower")
        .sort_values("stop_name")["stop_name"]
        .tolist()
    )
    print(f"Unique stop names: {len(unique_names)}")

    # Build alias table
    # official_name → [aliases...]
    alias_map: dict[str, List[str]] = {}

    for name in unique_names:
        aliases = normalise_name(name)
        # Merge with manual overrides
        if name in MANUAL_ALIASES:
            aliases = list(set(aliases + MANUAL_ALIASES[name]))
        if aliases:
            alias_map[name] = sorted(aliases)

    # Also add manual aliases for names that might not be in GTFS
    for official, aliases in MANUAL_ALIASES.items():
        if official not in alias_map:
            alias_map[official] = aliases

    # Write Markdown
    lines = [
        "# Malaysian Transit Stop Name Aliases",
        "",
        "This document maps official GTFS stop names to common colloquial names,",
        "abbreviations, and alternative spellings used by the public.",
        "Use this to resolve ambiguous place names in user queries.",
        "",
        "## Format",
        "Each entry: **Official GTFS name** → aliases",
        "",
        "---",
        "",
    ]

    for official in sorted(alias_map):
        aliases = alias_map[official]
        lines.append(f"**{official}**")
        lines.append(f"Also known as: {', '.join(aliases)}")
        lines.append("")

    output_path = "rag_data/stop-aliases.md"
    import os

    os.makedirs("rag_data", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\nWritten: {output_path}")
    print(f"Total alias entries: {len(alias_map)}")


if __name__ == "__main__":
    asyncio.run(main())
