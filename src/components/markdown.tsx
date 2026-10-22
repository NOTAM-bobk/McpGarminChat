"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function SafeLink({
  href,
  children,
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  const isSafe = typeof href === "string" && /^https?:\/\//i.test(href);
  if (!isSafe) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

function SafeImage({ alt }: { alt?: string }) {
  // Remote images can be used for tracking and add nothing to a data answer.
  return <span className="text-muted">[{alt || "image"} omitted]</span>;
}

/**
 * Raw HTML is never enabled, so model output cannot inject markup or scripts.
 * Links are restricted to http(s), open in a new tab with no referrer, and
 * remote images are not fetched.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: SafeLink, img: SafeImage }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
