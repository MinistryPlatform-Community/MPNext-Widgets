# Release Command

Create a release pull request from `dev` to `main` with auto-generated release notes summarizing all changes since the last release.

## Instructions

1. **Validate prerequisites:**
   - Ensure `gh` CLI is installed and authenticated
   - Ensure you're on the `dev` branch (or offer to switch)
   - Check for uncommitted changes and handle them

2. **Determine the last release point:**
   - Look for the most recent git tag on `main` (e.g., `v2026.1.15.1430`)
   - If no tags exist, find the last merge commit to `main`
   - If neither exists, use the initial commit
   - Display the last release reference to the user

3. **Gather all changes since last release:**
   - Get all merged PRs to `dev` since the last release:
     ```
     gh pr list --base dev --state merged --json number,title,body,mergedAt,author,labels --limit 500
     ```
   - Filter PRs merged after the last release date
   - Extract GitHub issue references from PR titles and bodies (patterns: `#123`, `Fix #123`, `Closes #123`, `Resolves #123`)

4. **Fetch issue details:**
   - For each referenced issue, fetch details:
     ```
     gh issue view <id> --json number,title,labels,state
     ```
   - Categorize issues by labels (bug, feature, enhancement, documentation, etc.)

5. **Generate version number:**
   - Automatically compute version using the project's date-time format: `yyyy.m.d.hhmm`
   - Use current UTC time:
     - `yyyy` = full year (e.g., 2026)
     - `m` = month without leading zero (1-12)
     - `d` = day without leading zero (1-31)
     - `hhmm` = hours and minutes in UTC with leading zeros (e.g., 0930, 1445)
   - Example: `2026.1.23.1430` for January 23, 2026 at 14:30 UTC
   - This matches the build version format used in `next.config.js` and displayed in the footer
   - No user confirmation needed - version is deterministic based on release time

6. **Write version to VERSION file:**
   - Write the computed version (without `v` prefix) to the `VERSION` file at repo root
   - This ensures the deployed app shows the exact same version as the release tag
   - Stage and commit: `git add VERSION && git commit -m "chore: set release version <version>"`
   - Push to dev: `git push origin dev`
   - This commit becomes part of the release PR (dev → main)

7. **Generate release notes:**
   - Create human-friendly descriptions for each change
   - Group by category (see Release Notes Format below)
   - Include links to PRs and issues
   - Summarize contributor activity

8. **Check for existing release PR:**
   - Run `gh pr list --base main --head dev --state open --json number,title,url`
   - If exists, offer to update it or abort

9. **Create the release PR:**
   - Use `gh pr create --base main --head dev --title "<title>" --body "<body>"`
   - Title format: `Release <version>` or `Release <version>: <summary>`

10. **Post-creation:**
   - Display the PR URL
   - Show the version number that was used
   - Display a formatted box with next steps:

```
┌─────────────────────────────────────────────────────────────────┐
│  Release PR Created Successfully!                               │
│                                                                 │
│  Version: v2026.1.23.1430                                       │
│  PR: https://github.com/org/repo/pull/XXX                       │
│                                                                 │
│  Next Steps:                                                    │
│  1. Review and approve the PR                                   │
│  2. Merge the PR to main                                        │
│  3. Run the finish command to create the tag and release:       │
│                                                                 │
│     /release-finish v2026.1.23.1430                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Arguments

- `$ARGUMENTS` - Optional arguments:
  - `--draft` - Create as draft PR
  - `--dry-run` - Show what would be included without creating PR
  - `--since <ref>` - Override the last release point (tag, commit, or date)

## Version Number Computation

The version is automatically computed at release time using this JavaScript logic (matching `next.config.js`):

```javascript
const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth() + 1;  // No leading zero
const day = now.getUTCDate();          // No leading zero
const hours = now.getUTCHours().toString().padStart(2, '0');
const minutes = now.getUTCMinutes().toString().padStart(2, '0');
const version = `${year}.${month}.${day}.${hours}${minutes}`;
// Result: "2026.1.23.1430"
```

## Release Notes Format

```markdown
# Release v<version>

> Released on <date>

## Summary

<Brief 1-2 sentence overview of this release>

## What's Changed

### Bug Fixes
- <Human-friendly description of fix> ([#123](link-to-pr)) - Fixes [#456](link-to-issue)
- <Another fix description> ([#124](link-to-pr))

### New Features
- <Human-friendly description of feature> ([#125](link-to-pr)) - Implements [#457](link-to-issue)

### Improvements
- <Human-friendly description of improvement> ([#126](link-to-pr))

### Documentation
- <Documentation update description> ([#127](link-to-pr))

### Other Changes
- <Other change description> ([#128](link-to-pr))

## Contributors

Thanks to the following contributors for this release:
- @username1
- @username2

---

**Full Changelog**: <link-to-compare-view>

Generated with [Claude Code](https://claude.ai/code)
```

## Example Workflow

```bash
# 1. Ensure on dev branch
git branch --show-current

# 2. Get the latest tag on main
git describe --tags --abbrev=0 origin/main 2>/dev/null || echo "No tags found"

# 3. Get the date of the last release
git log -1 --format=%ci <last-tag> 2>/dev/null

# 4. Get merged PRs since last release
gh pr list --base dev --state merged --json number,title,body,mergedAt,author,labels --limit 100

# 5. Get issue details for referenced issues
gh issue view 123 --json number,title,labels,state

# 6. Check for existing release PR
gh pr list --base main --head dev --state open --json number,title,url

# 7. Compute version number (UTC time)
# JavaScript equivalent: new Date() -> "2026.1.23.1430"
# In bash, compute as: date -u +"%Y.%-m.%-d.%H%M"

# 8. Write version to VERSION file and commit
echo "2026.1.23.1430" > VERSION
git add VERSION && git commit -m "chore: set release version 2026.1.23.1430"
git push origin dev

# 9. Create the release PR
gh pr create --base main --head dev --title "Release v2026.1.23.1430" --body "$(cat <<'EOF'
# Release v2026.1.23.1430

> Released on January 23, 2026

## Summary

This release includes 5 bug fixes and 3 new features.

## What's Changed

### Bug Fixes
- Fix bank name not displaying correctly on deposit list ([#800](https://github.com/org/repo/pull/800)) - Fixes [#779](https://github.com/org/repo/issues/779)

### New Features
- Add email notification for customer file uploads ([#799](https://github.com/org/repo/pull/799)) - Implements [#55](https://github.com/org/repo/issues/55)

## Contributors

Thanks to the following contributors:
- @developer1

---

**Full Changelog**: https://github.com/org/repo/compare/v2026.1.15.0930...dev

Generated with [Claude Code](https://claude.ai/code)
EOF
)"

# 10. After PR is merged, create the tag
git checkout main
git pull origin main
git tag -a v2026.1.23.1430 -m "Release v2026.1.23.1430"
git push origin v2026.1.23.1430

# 11. Optionally create GitHub Release
gh release create v2026.1.23.1430 --title "v2026.1.23.1430" --notes-file release-notes.md
```

## Categorization Rules

Categorize changes based on PR/issue labels and title patterns:

| Category       | Labels                              | Title Patterns                     |
|----------------|-------------------------------------|------------------------------------|
| Bug Fixes      | `bug`, `fix`, `bugfix`              | `fix`, `bugfix`, `hotfix`          |
| New Features   | `feature`, `enhancement`            | `add`, `feature`, `implement`      |
| Improvements   | `improvement`, `refactor`, `perf`   | `improve`, `refactor`, `optimize`  |
| Documentation  | `documentation`, `docs`             | `doc`, `readme`                    |
| Dependencies   | `dependencies`, `deps`              | `bump`, `upgrade`, `update deps`   |
| Other          | (none of the above)                 | (none of the above)                |

## Human-Friendly Description Guidelines

When generating descriptions:

1. **Start with a verb** - "Fix", "Add", "Update", "Improve", "Remove"
2. **Be specific** - Mention the affected feature or component
3. **Focus on user impact** - What can users now do? What problem is solved?
4. **Keep it concise** - One line, ideally under 80 characters

**Examples:**
- PR title: "Fix #779: Bank name not displaying correctly on deposit list"
  - Human-friendly: "Fix bank name not displaying correctly in deposit list view"
- PR title: "Add email notification for customer file uploads #55"
  - Human-friendly: "Add email notifications when customers upload files"
- PR title: "Refactor transaction service for better performance"
  - Human-friendly: "Improve transaction loading performance"

## Error Handling

- If `gh` CLI is not installed or not authenticated, provide setup instructions
- If no changes found since last release, inform user and abort
- If dev branch is behind main, warn user and suggest rebasing
- If PR creation fails, show the error and suggest manual steps
- Always show what would be included before creating the PR

## Notes

- Always sync dev with latest changes before creating release PR: `git pull origin dev`
- The release PR should be reviewed carefully before merging
- After merging, remember to create the git tag on main
- Consider using GitHub Releases for better visibility
- Include "Generated with [Claude Code](https://claude.ai/code)" in PR body
- Use HEREDOC for PR body to handle multiline content and special characters
- Version number is automatically computed using UTC time - no manual input needed
- The version format (`yyyy.m.d.hhmm`) matches the build version shown in the app footer
- The VERSION file at repo root is written with each release and read by `next.config.js` during Vercel builds to ensure the deployed app shows the exact release version
