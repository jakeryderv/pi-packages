export interface MarkdownMathSpan {
  start: number;
  end: number;
  expression: string;
  displayMode: boolean;
}

/**
 * Find TeX delimiters within a Markdown text token. Callers are responsible for
 * passing text tokens only, so code spans and fenced code stay untouched.
 */
export function findMarkdownMathSpans(value: string): MarkdownMathSpan[] {
  const spans: MarkdownMathSpan[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf("$", cursor);
    if (start === -1) {
      break;
    }
    if (isEscaped(value, start)) {
      cursor = start + 1;
      continue;
    }

    const displayMode = value[start + 1] === "$";
    const markerLength = displayMode ? 2 : 1;
    const contentStart = start + markerLength;
    const close = findClosingMarker(
      value,
      contentStart,
      markerLength,
      displayMode,
    );
    if (close === -1) {
      cursor = contentStart;
      continue;
    }

    const expression = value.slice(contentStart, close).trim();
    const end = close + markerLength;
    if (!expression || isAmbiguousCurrency(value, start, end, expression)) {
      cursor = end;
      continue;
    }

    spans.push({ start, end, expression, displayMode });
    cursor = end;
  }

  return spans;
}

function findClosingMarker(
  value: string,
  start: number,
  markerLength: number,
  displayMode: boolean,
): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] !== "$" || isEscaped(value, index)) {
      continue;
    }
    if (displayMode) {
      if (value[index + 1] === "$") {
        return index;
      }
      continue;
    }
    if (value[index - 1] !== "$" && value[index + 1] !== "$") {
      return index;
    }
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/** Avoid interpreting the two currency markers in `Costs $5 and $10`. */
function isAmbiguousCurrency(
  value: string,
  start: number,
  end: number,
  expression: string,
): boolean {
  return (
    value[start + 1] !== "$" &&
    /^\d/.test(expression) &&
    end < value.length &&
    /[A-Za-z0-9]/.test(value[end] ?? "")
  );
}
