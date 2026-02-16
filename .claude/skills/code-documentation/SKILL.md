---
name: code-documentation
description: Generate high-quality TSDoc/JSDoc for TypeScript files. Use when adding documentation to functions, interfaces, or classes.
---

# TypeScript Documentation Standards

You are an expert at writing professional TSDoc. When this skill is active, follow these rules strictly to ensure the codebase remains maintainable and compatible with TypeDoc.

## 1. Core Principles
- **Clarity over Verbosity**: Don't state the obvious (e.g., `setName(name)` doesn't need "Sets the name").
- **Type Redundancy**: Do NOT include types in JSDoc tags like `@param {string} name`. TypeScript already knows the type. Focus on the *purpose* and *constraints*.
- **Use Markdown**: Use backticks for code symbols and variables inside descriptions.

## 2. TSDoc Tag Usage
- `@param`: Describe the purpose. Mention any bounds or specific formats (e.g., "Must be a positive integer").
- `@returns`: Describe what the value represents, especially for complex objects.
- `@throws`: Document which specific errors are thrown and under what conditions.
- `@example`: Provide a minimal, runnable code snippet for complex logic.
- `@remarks`: Use for detailed technical notes that shouldn't clutter the main summary.
- `@deprecated`: Always provide an alternative if one exists.

## 3. Specific Patterns

### Interfaces and Types
Document every property unless it is completely self-explanatory.
```typescript
/**
 * Configuration for the document processor.
 */
readonly interface ProcessorConfig {
  /** The maximum file size in bytes. Default is 5MB. */
  readonly maxSize: number;
}

```

### Functions and Methods

Use the imperative mood for the first line.

```typescript
/**
 * Calculates the exponential backoff delay.
 * * @param attempt - The current retry count (0-indexed).
 * @returns The delay in milliseconds.
 * @example
 * const ms = getDelay(2); // returns 400
 */
function getDelay(attempt: number): number { ... }

```

## 4. Documentation Quality Checklist

1. Are all public-facing APIs documented?
2. Are edge cases or "gotchas" mentioned in `@remarks`?
3. Is the grammar professional and consistent?
4. Did I avoid redundant type annotations in the comment?

---
