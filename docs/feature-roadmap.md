# Launchboard — Feature Roadmap

**Updated:** 2026-11-07
**Purpose:** A simple view of the planned product updates. Versions are sequence targets, not date commitments.

Launchboard remains a personal opportunity-management and career-tracking workspace. Users find opportunities elsewhere; Launchboard helps them organize applications, manage next actions and learn from their progress.

| Version | Theme | Planned features | Status |
|---|---|---|---|
| **v1.1.0** | Responsive workspace | Responsive phone/tablet/desktop UI, navigation and layout refinements | Released |
| **v1.2.0** | **Action Center** | Tasks per opportunity, priorities, due dates, completion, overdue/Today/Upcoming/Unscheduled views, Dashboard Today section and Calendar task events | Released — production deployment and `ui-v1.2.0` Git release |
| **v1.3.0** | Quick Capture | Paste an opportunity URL, best-effort metadata extraction, review/edit before saving, source URL and duplicate warnings; later a lightweight browser extension | Planned |
| **v1.4.0** | Better Insights | Response, interview and offer conversion; response time; best-performing source; time in stage; honest filters and sample sizes | Planned |
| **v1.5.0** | Career Resources | Reusable CV versions, cover-letter templates, certificates, portfolio links, descriptions and version references linked to each opportunity | Planned |
| **v1.6.0** | Weekly Goals & Review | Weekly application/follow-up targets, completed-task progress, stale-opportunity review and week-over-week activity | Planned |
| **v2.0.0** | Intelligent Workspace | Optional AI opportunity analysis, skill-gap suggestions and interview preparation; optional integrations introduced carefully | Future |

## Later candidates

These ideas are intentionally not committed to a release yet:

- **Company and recruiter CRM:** reusable company/contact profiles and interaction history across opportunities.
- **Email integration:** optional detection of confirmations, interviews and rejections, with user approval before changing records.
- **Chrome extension:** one-click capture from external opportunity sites, prioritizing manual confirmation and resilient capture over fragile scraping.

## Product guardrails

- No built-in job marketplace, automatic applications or social network.
- No mandatory email connection, paid API or paid storage service.
- AI and external integrations remain optional.
- Keep CSV as a spreadsheet summary and JSON as the full-fidelity backup.
- Prefer a few complete, reliable workflows over excessive charts or a large chatbot.
- Every release follows the project's staged design, implementation, focused testing, full regression, documentation and explicit deployment approval workflow.

## Next update

**v1.2.0 — Action Center** is released to production and versioned in Git as `ui-v1.2.0`. Migration 004 is applied and live schema/grant verification passed. See `docs/v1.2-release-notes.md` for production evidence and `docs/v1.2-action-center-plan.md` for implementation and verification details.
