---
name: code
description: Generate high-quality TypeScript code files. Use when creating new code files, adding new functions, or refactoring existing code.
---

# Code

- To see test coverage: run `bun test --coverage`
- ALWAYS make sure types are okay after task by running `bunx tsc --noEmit`

# Code Style

When Writing Classes:
- Prefer decoupling instantiation from representation.
- Prefer using Data Transfer Objects.
- Prefer using Named Constructors.

- Prefer exporting things, including types, functions and classes.
- Prefer `for (const item of array)` over `array.forEach(() => {})`
- Use `await Bun.file(filepath).exists()` instead of fs equivalent.

Example
```typescript
export interface CircleFromOptions {
  readonly radius?: number;
}

export interface RectangleFromOptions {
  readonly width?: number;
  readonly height?: number;
}

export class Circle {
  private constructor(public radius: number) {}
  static Default(): Circle {
    return new Circle(1);
  }
  static From(options: CircleFromOptions): Circle {
    return new Circle(options.radius ?? 1);
  }
  static FromRadius(radius: number): Circle {
    return new Circle(radius);
  }
  grow(ratio: number): void {
    this.radius *= ratio;
  }
  area(): number {
    return Math.PI * this.radius ** 2;
  }
}

export class Rectangle {
  private constructor(
    public width: number,
    public height: number,
  ) {}
  static Default(): Rectangle {
    return new Rectangle(1, 1);
  }
  static From(options: RectangleFromOptions): Rectangle {
    return new Rectangle(options.width ?? 1, options.height ?? 1);
  }
  static FromCircle(circle: Circle): Rectangle {
    const circleArea = circle.area();
    return new Rectangle(circleArea, circleArea);
  }
  grow(ratio: number): void {
    this.width *= ratio;
    this.height *= ratio;
  }
  area(): number {
    return this.width * this.height;
  }
}
```

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
