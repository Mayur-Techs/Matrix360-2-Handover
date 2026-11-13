# Pratha — dedicated workstream

**Directory:** `workstreams/pratha/`  
**Development branch:** `work/pratha`  
**Scope:** Lead Intelligence and Campaign Console.

**Boundary:** No unapproved integration with Mayur; use only approved database roles and synthetic test data.

## Recovery checklist

- [ ] Import only reviewed, recovered source files into this folder
- [ ] Confirm no secrets, private lead data, virtual environments or generated artifacts
- [ ] Document runtime/build dependencies and local start instructions
- [ ] Provide an independently reproducible test command and its actual output
- [ ] Add functional CI to `.github/workflows/pratha.yml` after source recovery
- [ ] Open a pull request with evidence, risks and deployment impact

**Current status:** scaffold only. No application tests, deployments or integrations have been completed by this repository setup.
