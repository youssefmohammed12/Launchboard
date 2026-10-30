# Change Safety

## Before editing
- Inspect the relevant files before editing them. Read the component, its page, its props, and the utilities it uses.
- Understand existing behavior before proposing structural changes. The current architecture (React state in `App.tsx`, pages, shared components, `src/utils` helpers, `src/types`) is deliberate; preserve it.

## While editing
- Prefer the smallest reliable change that satisfies the task.
- Preserve established architecture and working features.
- Avoid rewriting complete components when a focused change is sufficient.
- Avoid unrelated cleanup and speculative refactoring.
- Avoid adding dependencies unless they have a clear technical purpose. This project is deliberately dependency-light.
- Explain compatibility implications before significant dependency upgrades.
- Never disable TypeScript checks, suppress errors, or misrepresent a failed check as success.
- Never overwrite user data or remove project features without explicit authorization.
- Report material assumptions and contradictions instead of silently guessing.
- Keep changes within the explicitly requested scope.

## Task planning
For complex tasks, identify the implementation stages and acceptance criteria **before** editing. Continue with implementation when the requirements are sufficiently clear — do not stop for confirmation on routine, reversible decisions.

## After editing
- Review the final diff and remove accidental or unrelated modifications.
- Re-read the files you changed to confirm they are complete and consistent.
