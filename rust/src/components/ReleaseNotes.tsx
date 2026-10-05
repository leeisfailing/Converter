import type { ReactNode } from "react";

const MAX_NOTE_CHARACTERS = 32_768;
const MAX_NOTE_LINES = 500;

interface Props {
  notes: string;
}

function inlineText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokens = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\[\]\n]+)\]\(([^\s()\[\]]+)\)/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index ?? 0;
    if (index > offset) nodes.push(text.slice(offset, index));
    if (match[1]) nodes.push(<code key={index}>{match[1]}</code>);
    else if (match[2]) nodes.push(<strong key={index}>{match[2]}</strong>);
    else {
      let href: string | null = null;
      try {
        const url = new URL(match[4]);
        if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) href = url.href;
      } catch {
        // Unsupported destinations remain ordinary text, never executable links.
      }
      nodes.push(href ? <span key={index} className="release-reference">{match[3]} <span className="release-reference-url">({href})</span></span> : match[0]);
    }
    offset = index + match[0].length;
  }
  if (offset < text.length) nodes.push(text.slice(offset));
  return nodes;
}

const HEADING = /^(#{1,6})\s+(.+)$/;
const BULLET = /^\s*[-*+]\s+(.+)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;

/** Render the small Markdown subset used by release notes as React elements.
 * Raw HTML, images, and unsupported links always remain escaped text.
 * Valid web references display their destinations without navigating the webview.
 */
export default function ReleaseNotes({ notes }: Props) {
  const boundedNotes = notes.slice(0, MAX_NOTE_CHARACTERS);
  const allLines = boundedNotes.replace(/\r\n?/g, "\n").split("\n");
  const truncated = notes.length > MAX_NOTE_CHARACTERS || allLines.length > MAX_NOTE_LINES;
  const lines = allLines.slice(0, MAX_NOTE_LINES);
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const key = index;
    if (!line.trim()) { index++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const Tag = heading[1].length <= 2 ? "h4" : "h5";
      blocks.push(<Tag key={key}>{inlineText(heading[2])}</Tag>);
      index++;
      continue;
    }
    const pattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (pattern) {
      const entries: ReactNode[] = [];
      while (index < lines.length) {
        const entry = lines[index].match(pattern);
        if (!entry) break;
        entries.push(<li key={index++}>{inlineText(entry[1])}</li>);
      }
      blocks.push(pattern === BULLET ? <ul key={key}>{entries}</ul> : <ol key={key}>{entries}</ol>);
      continue;
    }
    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !HEADING.test(lines[index]) && !BULLET.test(lines[index]) && !NUMBERED.test(lines[index]) && !/^```/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{inlineText(paragraph.join(" "))}</p>);
  }
  return <div className="release-notes">{blocks}{truncated && <p className="release-notes-truncated">Showing the first part of these release notes. Additional details are available in the GitHub release.</p>}</div>;
}
