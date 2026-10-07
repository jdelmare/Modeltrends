# AI Cyber Watch

A daily-updated dashboard comparing the cyber capabilities of frontier AI models: generally available models, gated cyber-specific models (Mythos, GPT-5.5-Cyber, Gemini Flash Cyber…), and open-weight models (GLM, DeepSeek, Kimi, MiMo…).

**What it shows**

| Section | Content |
|---|---|
| Filters | Model type (generally available, gated cyber, open-weight) or the *Eastern frontier* lab group: Alibaba, Ant Group, Baidu, ByteDance, DeepSeek, Moonshot AI, Qihoo 360, Shanghai AI Lab, StepFun, Tencent, Xiaomi, Z.ai. Groups are set by `group` on a provider in `data/models.json` |
| KPI row | Benchmark leader, best open-weight model and its lag behind the frontier, containment breakouts in the last 12 months, newest model, UK AISI capability doubling time |
| Leaderboard | Benchmark index, perceived capability, concern, 7-day deltas and trend sparklines, buzz, incidents. Click a row to see scores, sources and commentary |
| Capability & incidents over time | Two lanes on one time axis: benchmark index by release date (colored by GA, gated or open-weight) above, one mark per incident by week below. Models involved in incidents are ringed; hover either to see the links |
| Benchmark explorer | Per-benchmark bar chart; self-reported scores are marked |
| Breakouts & misuse | Incident list: sandbox escapes, threat-actor misuse, government action over specific models |
| The read | Per-lab takes and the latest coverage (official posts, articles, blogs, podcasts, social, papers) |

## How it updates

`.github/workflows/daily-update.yml` runs every day at 06:17 UTC and does three things:

1. **Collects** recent items from the security press, lab blogs, podcasts, arXiv, Hacker News, Reddit, Bluesky and Hugging Face. The source list is in `scripts/sources.json`. It counts how often each tracked model is mentioned, which gives the **buzz** figure.
2. **Analyzes** the items with Claude (`scripts/analyze.py`), which runs in two passes:
   - A web-search research pass looks for new models, benchmark results, incidents and commentary the feeds missed.
   - A structured-output pass turns the findings into validated updates: new models, scores, incidents, re-scored perception and headlines.
3. **Merges and snapshots.** It adds the updates to `data/*.json` and appends today's numbers to `data/history.json`, which drives the trend lines. It then commits the data and deploys the site to GitHub Pages.

Anything the pipeline adds by itself carries an `auto` badge until a person reviews it. To review, edit the JSON and remove the `auto` / `auto_added` field. Perception scores are smoothed day to day, and URLs are validated before anything is merged.

### Setup

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets → Actions**:
   - `ANTHROPIC_API_KEY` (required for the Claude analysis; without it the run collects feeds and counts buzz only)
   - `ANTHROPIC_WORKSPACE_ID` (only if your API key is not scoped to a workspace; the API then rejects requests without it. Find the ID under Console → Settings → Workspaces)
   - `BSKY_HANDLE`, `BSKY_APP_PASSWORD` (optional, adds Bluesky search)
3. Run the workflow once from the Actions tab (**Run workflow**).

### Run locally

```bash
pip install -r scripts/requirements.txt
python scripts/update.py            # full run (uses ANTHROPIC_API_KEY if set)
python scripts/update.py --no-llm   # feeds + buzz only
python scripts/update.py --offline  # recompute index + snapshot only
python -m http.server               # then open http://localhost:8000
```

## Methodology

- **Benchmark index (0–100).** On each capability benchmark, a model's score is normalized to the best tracked score (the best score = 100). The index is the mean of those normalized scores, shrunk toward 50 so that one strong benchmark can't outrank broad coverage. Self-reported numbers count 0.8×. Safeguard metrics such as jailbreak refusal are shown but not included in the index. The code is in `scripts/scoring.py`.
- **Perceived capability / concern (0–100) and tone (−1…1).** These are Claude's synthesis of what articles, podcasts, blogs and social posts say. They are subjective by design, and each score links to its sources.
- **Incidents.**
  - `breakout`: a model or agent acted outside its sanctioned scope (escaped a sandbox, reached real systems, took unauthorized actions).
  - `misuse`: threat actors used AI models or agents in an operation.
  - `policy`: a government or regulator restricted, investigated or compelled action over specific models or their incidents.
  - Severity follows the status palette: critical, serious, warning, info.
  - Only confirmed incidents that directly involve an AI model are shown. General security news, bugs in AI products, attacks on AI users, lab program changes and industry statistics are out of scope.
  - Rejected and unconfirmed entries stay in `data/incidents.json` with `"excluded": true` and an `excluded_reason`, so the pipeline doesn't re-add them; the dashboard hides them. To show one, delete its `excluded` key.

The seed data (Sept 28, 2026) was researched by hand from system cards, UK AISI, NIST CAISI, lab disclosures and press coverage. Every number links to its source.
