import * as React from "react";

// A markdown SUBSET renderer for rich longText cells: bold, italic, inline
// code, links, bullet/numbered lists, headings. Deliberately not a library —
// TipTap is ~200 kB gz and react-markdown ~40 kB for what is, in a table cell,
// six inline patterns and three block shapes. The value stays a plain string,
// so swamp_search_clause still finds it and CSV export is untouched.
//
// Escaping-first: the raw text NEVER reaches the DOM as HTML. Everything is
// built as React elements, so there is no sanitisation step to get wrong.

/** Inline spans: `code`, **bold**, *italic*, [label](url). One pass, ordered. */
function renderInline(text: string, keyBase: number): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Alternation order matters: code first so ** inside backticks stays literal.
  const re =
    /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = keyBase;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] != null) {
      out.push(
        <code key={k++} className="rounded bg-muted px-1 font-mono-data text-[0.9em]">
          {m[2]}
        </code>
      );
    } else if (m[4] != null) {
      out.push(<strong key={k++}>{m[4]}</strong>);
    } else if (m[6] != null) {
      out.push(<em key={k++}>{m[6]}</em>);
    } else if (m[8] != null) {
      out.push(
        <a
          key={k++}
          href={m[9]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline underline-offset-2"
        >
          {m[8]}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: React.ReactNode[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={key++} className="list-decimal pl-5">{items}</ol>
      ) : (
        <ul key={key++} className="list-disc pl-5">{items}</ul>
      )
    );
    list = null;
  };

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);

    if (bullet || numbered) {
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(<li key={key++}>{renderInline((bullet ?? numbered)![1], key * 100)}</li>);
      continue;
    }
    flushList();

    if (heading) {
      blocks.push(
        <p key={key++} className="font-semibold">
          {renderInline(heading[2], key * 100)}
        </p>
      );
    } else if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-2" />);
    } else {
      blocks.push(<p key={key++}>{renderInline(line, key * 100)}</p>);
    }
  }
  flushList();

  return <div className={className}>{blocks}</div>;
}
