const ANSI_SGR_PATTERN = /^\u001b\[[0-9;]*m$/;

export function getStockDashboardAgeLabel(ageSeconds: number): string {
  const age = Math.max(0, Math.floor(ageSeconds));
  return age > 30
    ? `Dashboard-Stand ${age}s alt`
    : `Dashboard-Update vor ${age}s`;
}

function getVisibleWidth(text: string): number {
  return Array.from(text.replace(/\u001b\[[0-9;]*m/g, "")).length;
}

function updateAnsiStyles(styles: string[], token: string): void {
  if (!ANSI_SGR_PATTERN.test(token)) return;

  const codes = token.slice(2, -1).split(";").filter(Boolean);
  if (codes.includes("0")) {
    styles.length = 0;
    const remainingCodes = codes.filter((code) => code !== "0");
    if (remainingCodes.length > 0) {
      styles.push(`\u001b[${remainingCodes.join(";")}m`);
    }
  } else {
    styles.push(token);
  }
}

export function wrapText(
  text: string,
  maxWidth: number,
  indent = "",
): string[] {
  const width = Math.floor(maxWidth);
  if (!Number.isFinite(width) || width < 1) {
    throw new RangeError("maxWidth must be a positive finite number.");
  }

  const lines: string[] = [];
  const styles: string[] = [];
  const indentWidth = getVisibleWidth(indent);
  let line = indent;
  let lineWidth = indentWidth;

  const startNewLine = (): void => {
    if (styles.length > 0) line += "\u001b[0m";
    lines.push(line);
    line = indent + styles.join("");
    lineWidth = indentWidth;
  };

  const appendWord = (word: string): void => {
    const tokens = word.match(/\u001b\[[0-9;]*m|./gu) ?? [];
    const wordWidth = getVisibleWidth(word);
    const spacerWidth = lineWidth > indentWidth ? 1 : 0;

    if (
      lineWidth > indentWidth &&
      lineWidth + spacerWidth + wordWidth > width
    ) {
      startNewLine();
    }

    if (lineWidth > indentWidth) {
      line += " ";
      lineWidth++;
    }

    for (const token of tokens) {
      if (ANSI_SGR_PATTERN.test(token)) {
        updateAnsiStyles(styles, token);
        line += token;
        continue;
      }

      if (lineWidth >= width && lineWidth > indentWidth) {
        startNewLine();
      }
      line += token;
      lineWidth += getVisibleWidth(token);
    }
  };

  const paragraphs = text.split(/\r?\n/);
  for (const [index, paragraph] of paragraphs.entries()) {
    const words =
      paragraph.match(/(?:\u001b\[[0-9;]*m|[^\s])+/gu) ?? [];
    if (words.length === 0) {
      if (line !== indent) startNewLine();
      else lines.push(indent);
      continue;
    }

    for (const word of words) appendWord(word);
    if (index < paragraphs.length - 1) startNewLine();
  }

  if (line !== indent || lines.length === 0) {
    if (styles.length > 0) line += "\u001b[0m";
    lines.push(line);
  }
  return lines;
}
