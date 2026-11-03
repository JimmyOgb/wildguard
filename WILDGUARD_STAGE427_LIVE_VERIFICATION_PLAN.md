# WILDGUARD — STAGE 4.27: LIVE VERIFICATION PLAN
## Controlled Production Verification Plan for Otari Gateway Inference

**Date:** 2026-11-03  
**Status:** AWAITING OPERATOR AUTHORIZATION (Zero paid calls dispatched)  
**Target Environment:** Vercel Preview Deployment  
**Target Deployment URL:** `https://wildguard-3byh0egus-jamism123.vercel.app`  

---

## 1. Controlled Verification Parameters

To strictly contain expenditure and verify the 25-second reliability fix, the verification is divided into two controlled, single-request test cases:

### Test Case A: Single Chat Turn (Verify Outbound In-Context Inference)
- **Deployment URL:** `https://wildguard-3byh0egus-jamism123.vercel.app`
- **Target Endpoint:** `POST /api/chat`
- **Target Model:** `alibaba/qwen-3.5-35b-a3b`
- **Role:** `coder`
- **Exact Prompt:**  
  `"Write a Python function named 'add_numbers' that adds two integers and returns the sum. Output only the code."`
- **Maximum Output Tokens (`maxTokens`):** `256` tokens
- **Timeout Window:** `25,000` ms (25 seconds)
- **Max Requests:** Exactly `1` request
- **Estimated Cost:** ~$0.0001 – $0.0003 USD
- **Pre-Reservation Amount:** `$0.05` USD
- **Expected Success Criteria:**
  1. Returns HTTP `200 OK`.
  2. Latency completes within 10–18 seconds (comfortably under the 25s client timeout and 60s Vercel ceiling).
  3. Response payload contains valid structured text containing `def add_numbers(a, b):`.
  4. Response is non-empty (`content` length > 10).
  5. Redis budget atomically settles exact cost (~$0.0002) and clears reservation.
  6. Zero fallback triggered.

---

### Test Case B: Step Loop Explorer Step (Verify Single-Step Orchestration)
- **Deployment URL:** `https://wildguard-3byh0egus-jamism123.vercel.app`
- **Target Endpoint:** `POST /api/workflow/step/explorer`
- **Target Model:** `deepseek/deepseek-v4.1-flash`
- **Role:** `explorer`
- **Exact Prompt / Task:**  
  `"Inspect the repository structure and list files relevant to configuration."`
- **Payload Headers:** `x-idempotency-key: stage427_verify_explorer_001`
- **Maximum Output Tokens:** `400` tokens
- **Timeout Window:** `25,000` ms (25 seconds)
- **Max Requests:** Exactly `1` request
- **Estimated Cost:** ~$0.0001 USD
- **Pre-Reservation Amount:** `$0.05` USD
- **Expected Success Criteria:**
  1. Returns HTTP `200 OK`.
  2. Latency completes within 7–12 seconds (well below the 25s threshold).
  3. Response payload contains valid bulleted investigation plan with non-empty content.
  4. Redis budget settles exactly once.
  5. UI elapsed timer increments accurately without timing out at 7.5s.

---

## 2. Budget Ceiling & Expenditure Limits

| Metric | Bound |
|:---|:---|
| **Global Budget Ceiling** | $10.00 USD |
| **Current Global Spend** | $0.452597 USD |
| **Current Remaining Global Allowance** | $9.547403 USD |
| **Maximum Authorized Spending for this Verification** | **$0.02 USD** |
| **Per-Run Budget Cap** | $1.50 USD |
| **Max Combined Requests** | 2 requests total (1 Chat + 1 Explorer) |

---

## 3. Budget Reservation and Settlement Protocol

1. **Pre-Flight Check:**
   - Server checks `remainingGlobalUsd >= $0.05`. If exceeded, fails closed immediately with HTTP 402.
2. **Atomic Pre-Reservation:**
   - Server reserves `$0.05` in Upstash Redis via atomic lua script `reserve_budget`.
3. **Dispatch & Monitoring:**
   - Server dispatches outbound HTTPS request to `https://api.otari.ai/api/v1/chat/completions` with a strict `AbortSignal` tied to the 25,000ms deadline.
4. **Settlement on HTTP 200:**
   - On completion, actual token count and actual cost are calculated and settled via `settle_budget` lua script. The unused portion of the $0.05 reservation is released immediately.
5. **Handling of Timeout or Network Interrupt:**
   - If aborted or interrupted, the $0.05 reservation is marked as `uncertain` to ensure financial conservativeness and prevent undercounting.

---

## 4. Execution Command Reference (Upon Authorization Only)

```bash
# Authorization Command for Test Case A (Chat):
curl -s -X POST https://wildguard-3byh0egus-jamism123.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Write a Python function named 'add_numbers' that adds two integers and returns the sum. Output only the code.",
    "role": "coder",
    "maxTokens": 256
  }'

# Authorization Command for Test Case B (Step Loop Explorer):
curl -s -X POST https://wildguard-3byh0egus-jamism123.vercel.app/api/workflow/step/explorer \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: stage427_verify_explorer_001" \
  -d '{
    "task": "Inspect the repository structure and list files relevant to configuration."
  }'
```

---

## 5. Explicit Hold Gate

> [!WARNING]
> DO NOT EXECUTE THE COMMANDS ABOVE UNTIL EXPLICIT WRITTEN OPERATOR AUTHORIZATION IS RECEIVED.
> Antigravity is currently halted at the verification authorization boundary.
