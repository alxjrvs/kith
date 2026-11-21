import { Fragment, type ReactNode } from "react";

/**
 * A small Markdown renderer for knowledge pages: headings, paragraphs, lists,
 * quotes, rules, **bold**, *italic*, `code` and [links](https://…).
 *
 * It builds React elements and never sets HTML, so whatever an organiser types
 * is text. Links are kept only when they are http(s) or mailto.
 */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const content = inline(heading[2]!);
      blocks.push(level === 1 ? <h2 key={key++}>{content}</h2> : level === 2 ? <h3 key={key++}>{content}</h3> : <h4 key={key++}>{content}</h4>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key++} />);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i]!)) {
        items.push(<li key={items.length}>{inline(lines[i]!.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quoted.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key++}>{inline(quoted.join(" "))}</blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|>|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i]!)) {
      paragraph.push(lines[i++]!);
    }
    blocks.push(<p key={key++}>{inline(paragraph.join(" "))}</p>);
  }
  return <div className="prose">{blocks}</div>;
}

const TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    if (match[1]) out.push(<code key={n++}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={n++}>{token.slice(2, -2)}</strong>);
    else if (match[3]) out.push(<em key={n++}>{token.slice(1, -1)}</em>);
    else {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? [];
      out.push(
        href && /^(https?:|mailto:)/i.test(href) ? (
          <a key={n++} href={href} rel="noopener noreferrer" target="_blank">
            {label}
          </a>
        ) : (
          <Fragment key={n++}>{label}</Fragment>
        ),
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
