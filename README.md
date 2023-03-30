# A template repo

## Linting

The `.eslintrc.json` file was split into two files:

- `.eslintrc.json`: The main eslint config for use in all
  projects.
- `.eslintrc.react.json`: For React projects.

If the project includes React, simply combine these two into
a single file, otherwise move the `.eslintrc.react.json`
file into the appropriate package and rename to
`.eslintrc.json`.
