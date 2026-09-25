# Worked example: rewriting a draft board

One turn, end to end: what the user wrote, what the agent wrote back onto the
board, and what it said in chat. The point is the shape of the transformation,
not the React specifics.

## The user's draft (`.lavagna/todo-component.lavagna.md`)

    # Todo component

    The todo component should now work like this

    ```tsx
    const Todo:FC<TodoProps> = (props) => {
        const [todo, setTodo] = useState(props.todo)

        const handleCheck = (checked: boolean) => {
            setTodo(...)
        }

        useEffect(() => {
            props.onTodoCheck(todo.checked)
        }; [todo])

        useEffect(() => {
            setTodo({...props.todo})
        }, [props.todo])

        return (...)
    }
    ```

    in the folder todo

    ```tree
    src
    └─compnennts
      ├─Todo => add this one
      └─Todos => edit this
    ```

    ![canvas](.lavagna/media/3f9a1c.png)

## What the agent checked first

- Opened `src/components/Todos/index.tsx`, found the list already holds the
  todos array and passes callbacks down, so a child copy of `todo` in state is
  redundant.
- Confirmed the folder is `src/components` (the draft's `compnennts` is a
  typo, not a real path).
- Saw that `Todos` already applies optimistic updates on toggle.

## The rewritten board

    # Todo component

    ## Decision

    `Todo` is a controlled component: it renders `props.todo` and reports
    intent through `onTodoChecked`. No local copy of the todo, no effects.
    `Todos` owns the state and already updates optimistically, so the child
    never needs to sync back.

    ## Files

    ```tree
    src
    └─components
      ├─Todo
      │ └─index.tsx      // NEW
      └─Todos
        └─index.tsx      // edit: render <Todo>, pass onTodoChecked
    ```

    See [@src/components/Todos/index.tsx:41-58](src/components/Todos/index.tsx#L41-L58)
    for the toggle handler the child will call.

    ## Sketch

    ```tsx
    const Todo: FC<TodoProps> = ({ todo, onTodoChecked }) => {
      const handleCheck = (checked: boolean) => {
        onTodoChecked(todo.id, checked); // parent is optimistic; nothing to sync here
      };
      return (...);
    };
    ```

    ## Work

    - [ ] Add `src/components/Todo/index.tsx` (controlled, props only)
    - [ ] Render `<Todo>` from `Todos`, wiring `onTodoChecked` to the existing toggle handler
    - [ ] Remove the per-item markup that `Todos` renders inline today

    > ꩜ Question: should `Todo` also expose a delete affordance now, or is that a separate board?

    ![canvas](.lavagna/media/3f9a1c.png)

What changed and why it matters:

- The pasted draft code became a sketch that reflects the decision, not a
  copy of what the user typed.
- The tree keeps the user's structure and gains the exact annotations the
  `lavagna-execute` skill acts on. The typo in the folder name is fixed
  because the tree now describes real paths.
- The `=> add this one` arrows became `// NEW` and `// edit:` notes.
- A checklist appeared, because the board now describes work to do.
- The one open question sits on the board as a `> ꩜ Question:` blockquote,
  so the user answers where the plan lives.
- The canvas line is carried over untouched.

## The chat reply, same turn

> Rewrote the board. I took two liberties: dropped both `useEffect`s and the
> local `todo` state, since `Todos` already updates optimistically and a
> controlled `Todo` avoids the props-to-state sync (see the
> "you might not need an effect" pattern); and corrected the folder name to
> `src/components`. One question is on the board about a delete affordance;
> everything else is ready to execute.
