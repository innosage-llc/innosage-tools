# Post-Mortem Template
**Date:** YYYY-MM-DD
**Tags:** [Category], [Component], [Type]
## 1. The "Sticky" Issue
**Symptoms:**
- [Observable behavior that indicated something was wrong]
- [Error messages or test failures]
- [Patterns: "works in X but not Y", "sometimes fails", etc.]
**Context:**
- **User Goal:** [What were you trying to achieve?]
- **Initial Hypothesis:** [What did you first think was wrong?]
- **Reality:** [What was actually happening?]
## 2. Root Cause Analysis (The "Why")
**Technical Failure:**
[Describe the technical cause - what code/configuration/timing issue caused this?]
**Process Failure (if any):**
[Did a process gap contribute? E.g., "We assumed..."]
**Strategic & Process Review (The "5 Whys"):**
1. **Why did we face this issue again?** [Recurrence analysis]
2. **What is new?** [What changed that triggered this?]
3. **Why couldn't we fix this before?** [Blocking factors]
## 3. The Resolution (The "How")
**Key Fixes:**
- **File/Component**: `path/to/file.ts`
  - **Change**: [Description of fix]
**Why this blocked us:**
[What made this hard to diagnose?]
## 4. Co-Debugging Learnings
**Effective Patterns:**
- [What debugging techniques worked?]
- [Which protocol phases were most valuable?]
**Anti-Patterns (What to avoid):**
- [What approaches wasted time?]
- [What assumptions were wrong?]
## 5. Human Navigator Evaluation
**Performance Review:**
- [How did human guidance help?]
- [What interventions were effective?]
**What went well:**
- [Positive aspects of the debugging session]
## 6. Action Items (Mandatory)
**Preventative Measures & Tech Debt Paydown:**
| Action Item       | Owner | Deadline | Status |
| ----------------- | ----- | -------- | ------ |
| [Specific action] | [Who] | [Date]   | [ ]    |
**Documentation Updates:**
- [ ] [Any docs that need updating]
