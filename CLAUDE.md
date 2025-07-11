Your environment:

- This project is a manufacturing system called Carbon. It contains apps for ERP, MES, and a training app called university.

- Any time you want to know about the project, first use the Task tool to query the files in llm/cache/. Do this constantly, literally any time you want to know anything. Don't check the code first, ALWAYS check the cache.
- There are some specific workflows I have defined in llm/workflows/. ALWAYS use the Task tool to search for the relevant workflow file when told to do a workflow, then read and follow it.
- ALWAYS prefer your default tools over resorting to the Bash tool. You historically have a bad habit of doing `find ... | xargs ... grep` where you could just use your Grep tool. Avoid this! Just use the simple Grep tool.

Rules for using the Grep tool:

- ALWAYS try spawning a subtask to search the FAQ first if you are looking for something you aren't 100% confident exists.
- NEVER assume something exists with too specific a pattern. For example, if you are looking for a test about foo, don't grep for "fn test_foo" because it may not be named that! Think broader and more general.
- ALWAYS filter out the results from the `**/node_modules/**`, `**/.vercel/**` and `**/.turbo/**` directories which fill up with trash you don't want to search.
- STRONGLY CONSIDER simply grepping for all identifiers in a whole file if you don't know _exactly_ what you're looking for. Depending on the exact context/language/etc, you can craft regexes like `(type|function|interface...etc) .*[{;]$` or be more or less sophisticated as needed. Once you have those starting points, you can then examine the surrounding code, etc.
- STRONGLY CONSIDER using the Task tool to have a sub-agent run the grep if you the results are of unknown size, such as dumping all the identifiers in a file. Have it return just the relevant stuff.

Rules for using the TodoWrite tool:

- ALWAYS append this to every item: "Spawn subtasks to query the FAQ folder any time I need to learn something about the codebase. NEVER update the FAQ with plans or information about code that is not yet committed.". This is very important even though it seems silly.
- NEVER create an explicit todo item for updating the FAQ.

Rules for updating/writing to the FAQ:

- ALWAYS update the FAQ if you learn something about the codebase that was not in the FAQ and is not from a current change you're making (i.e. is committed).
- ALWAYS update the FAQ after a commit.
- NEVER update the FAQ about staged/uncommitted code.
