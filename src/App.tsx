import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, MessageCircle, Search, Share } from "lucide-react";
import {
  type Comment,
  type Mode,
  type Story,
  type Profile,
  FEED_URL,
  fallbackStories,
  loadProfile,
  saveProfile,
  normalizeStory,
  rankStories,
  fetchCommentTree,
  stripHtml,
  timeAgo,
  recordSignal as recordSignalFn,
} from "./recommendation";

export default function App() {
  const [mode, setMode] = useState<Mode>("for-you");

  const { data: stories = [], isLoading: feedLoading } = useQuery({
    queryKey: ["hn-feed"],
    queryFn: async () => {
      try {
        const res = await fetch(FEED_URL);
        const data = await res.json();
        return (data.hits || [])
          .map(normalizeStory)
          .filter((s: Story) => s.title);
      } catch {
        return fallbackStories();
      }
    },
  });

  const [selected, setSelected] = useState<Story | null>(null);
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [activeIndex, setActiveIndex] = useState(0);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("liked-stories") || "{}");
    } catch {
      return {};
    }
  });
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: searchResults = [], isFetching: searching } = useQuery<Story[]>(
    {
      queryKey: ["hn-search", searchQuery],
      queryFn: async () => {
        if (!searchQuery.trim()) return [];
        const res = await fetch(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(searchQuery)}&hitsPerPage=20`,
        );
        const data = await res.json();
        return (data.hits || [])
          .map(normalizeStory)
          .filter((s: Story) => s.title);
      },
      enabled: showSearch && searchQuery.trim().length > 0,
      staleTime: 10 * 60 * 1000,
    },
  );
  const [showComments, setShowComments] = useState(false);
  const [commentStory, setCommentStory] = useState<Story | null>(null);

  const { data: commentTree = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["hn-comments", commentStory?.id],
    queryFn: async () => {
      if (!commentStory) return [];
      return fetchCommentTree(commentStory.id);
    },
    enabled: showComments && !!commentStory,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  const avgDwell = profile.views
    ? Math.round(profile.dwellTotal / profile.views)
    : 0;

  const rankedStories = useMemo(() => {
    return rankStories(stories, mode, profile, avgDwell);
  }, [mode, profile, stories, avgDwell]);

  useEffect(() => {
    try {
      localStorage.setItem("liked-stories", JSON.stringify(liked));
    } catch {}
  }, [liked]);

  // Observe which card is active using IntersectionObserver
  useEffect(() => {
    const ids = rankedStories.map((s) => s.id);
    let currentActive: string | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute("data-id") || "";
          if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
            if (currentActive !== id) {
              currentActive = id;
              const idx = ids.indexOf(id);
              setActiveIndex(idx >= 0 ? idx : 0);
              const story = rankedStories[idx];
              if (story) setSelected(story);
            }
          }
        });
      },
      { threshold: [0.35, 0.55, 0.75] },
    );

    rankedStories.forEach((s) => {
      const el = cardRefs.current[s.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedStories]);

  function toggleLike(story: Story) {
    setLiked((l) => {
      const next = { ...l, [story.id]: !l[story.id] };
      if (!l[story.id]) {
        setProfile((p) => recordSignalFn(story, "open", 2, 0, p));
      }
      return next;
    });
  }

  async function shareStory(story: Story) {
    try {
      if ((navigator as any).share) {
        await (navigator as any).share({ title: story.title, url: story.url });
      } else {
        await navigator.clipboard.writeText(story.url);
      }
    } catch {
      // ignore
    }
  }

  function openStory(story: Story) {
    setSelected(story);
    setProfile((p) => recordSignalFn(story, "open", 1, 0, p));
    try {
      const win = window.open(story.url, "_blank");
      if (win) win.opener = null;
    } catch {
      // ignore
    }
  }

  // Helper: generate a small SVG placeholder data URI when image fails
  function svgPlaceholder(text: string) {
    const escaped = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'><rect width='100%' height='100%' fill='#0f172a'/><text x='50%' y='50%' fill='#94a3b8' font-family='Inter,system-ui,sans-serif' font-size='36' dominant-baseline='middle' text-anchor='middle'>${escaped}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto min-h-screen max-w-[680px]">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-border">
          <div className="px-4 py-2 flex items-center justify-between gap-2">
            <span className="text-lg font-bold tracking-tight shrink-0">
              Better HN
            </span>
            <div className="flex items-center gap-1">
              <Tab
                active={mode === "for-you"}
                onClick={() => setMode("for-you")}
              >
                For you
              </Tab>
              <Tab
                active={mode === "trending"}
                onClick={() => setMode("trending")}
              >
                Trending
              </Tab>
              <div className="w-px h-4 bg-border mx-1" />
              <button
                onClick={() => {
                  setShowSearch(true);
                  setSearchQuery("");
                }}
                className="flex items-center gap-1.5 text-[13px] text-muted hover:text-white px-2 py-1 transition-colors"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Feed */}
        <div className="divide-y divide-border">
          {rankedStories.map((story, idx) => {
            const isSelected = selected?.id === story.id;
            return (
              <article
                key={story.id}
                data-id={story.id}
                ref={(el) => {
                  cardRefs.current[story.id] = el;
                }}
                onClick={() => openStory(story)}
                className={`cursor-pointer transition-colors px-4 py-4 hover:bg-white/[0.04]`}
              >
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                      <span className="text-white font-semibold">
                        {story.author || "Unknown"}
                      </span>
                      <span>·</span>
                      <span>{timeAgo(story.createdTs)}</span>
                      {story.domain && (
                        <>
                          <span>·</span>
                          <span className="text-accent">{story.domain}</span>
                        </>
                      )}
                    </div>

                    <h3 className="text-[17px] md:text-[18px] font-semibold text-white leading-relaxed mt-1">
                      {story.title}
                    </h3>
                    {story.excerpt && (
                      <p className="text-[14px] text-muted mt-2 line-clamp-3">
                        {story.excerpt}
                      </p>
                    )}

                    <img
                      src={story.image || svgPlaceholder(story.title)}
                      alt={story.title}
                      className="mt-3 h-96 w-full rounded-2xl border border-border object-cover"
                      onError={(e) => {
                        if (
                          (e.target as HTMLImageElement).src !==
                          svgPlaceholder(story.title)
                        ) {
                          (e.target as HTMLImageElement).src = svgPlaceholder(
                            story.title,
                          );
                        }
                      }}
                    />

                    <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCommentStory(story);
                          setShowComments(true);
                        }}
                        className="flex items-center gap-2 hover:text-white transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>{story.comments}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLike(story);
                        }}
                        className="flex items-center gap-2 hover:text-white transition-colors"
                      >
                        <Heart
                          className={`w-4 h-4 ${liked[story.id] ? "text-accent" : ""}`}
                        />
                        <span>{story.points + (liked[story.id] ? 1 : 0)}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          shareStory(story);
                        }}
                        className="flex items-center gap-2 hover:text-white transition-colors"
                      >
                        <Share className="w-4 h-4" />
                        <span>Share</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* Search modal */}
      {showSearch ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[15vh]"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSearch(false);
          }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-border bg-black shadow-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="w-4 h-4 text-muted shrink-0" />
              <input
                type="text"
                placeholder="Search Hacker News..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-muted"
                autoFocus
              />
              <button
                onClick={() => setShowSearch(false)}
                className="text-[13px] text-muted hover:text-white shrink-0"
              >
                Esc
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
              {searching ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">
                  Searching...
                </div>
              ) : searchQuery && searchResults.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">
                  No results found
                </div>
              ) : !searchQuery ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">
                  Type to search HN stories
                </div>
              ) : (
                searchResults.map((result) => (
                  <div
                    key={result.id}
                    onClick={() => {
                      openStory(result);
                      setShowSearch(false);
                    }}
                    className="px-4 py-3 cursor-pointer hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-center gap-2 text-[12px] text-muted">
                      <span className="text-white font-medium text-[13px]">
                        {result.author}
                      </span>
                      <span>·</span>
                      <span>{timeAgo(result.createdTs)}</span>
                      {result.domain && (
                        <>
                          <span>·</span>
                          <span className="text-accent">{result.domain}</span>
                        </>
                      )}
                    </div>
                    <div className="text-[14px] text-white font-medium mt-0.5 line-clamp-2">
                      {result.title}
                    </div>
                    <div className="flex items-center gap-3 text-[12px] text-muted mt-1">
                      <span>{result.points} points</span>
                      <span>{result.comments} comments</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Comments modal */}
      {showComments ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowComments(false);
          }}
        >
          <div className="w-full max-w-2xl mx-auto bg-black border border-border rounded-t-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <span className="text-[15px] font-semibold text-white">
                  Comments
                </span>
                {commentStory && (
                  <span className="text-[13px] text-muted ml-2">
                    on {commentStory.title.slice(0, 60)}
                  </span>
                )}
              </div>
              <button
                onClick={() => setShowComments(false)}
                className="text-[13px] text-muted hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {commentsLoading ? (
                <div className="text-center text-[13px] text-muted py-8">
                  Loading comments...
                </div>
              ) : commentTree.length === 0 ? (
                <div className="text-center text-[13px] text-muted py-8">
                  No comments yet
                </div>
              ) : (
                commentTree.map((c) => (
                  <CommentThread key={c.id} comment={c} depth={0} />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CommentThread({
  comment,
  depth,
}: {
  comment: Comment;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(depth > 0);
  const text = comment.text
    ? stripHtml(comment.text).slice(0, 600)
    : "[deleted]";
  const childCount = comment.children?.length || 0;
  return (
    <div className={`${depth > 0 ? "ml-6 border-l border-border pl-3" : ""}`}>
      <div className="py-1.5">
        <div className="flex items-center gap-2 text-[12px] text-muted">
          {childCount > 0 && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="text-[11px] text-muted hover:text-white mr-0.5 shrink-0 w-4 text-center"
            >
              {collapsed ? "+" : "−"}
            </button>
          )}
          <span className="text-[13px] font-medium text-white">
            {comment.author || "anonymous"}
          </span>
          {childCount > 0 && (
            <span className="text-[11px] text-muted">
              {childCount} {childCount === 1 ? "reply" : "replies"}
            </span>
          )}
          {comment.points != null && (
            <>
              <span>·</span>
              <span>{comment.points} pts</span>
            </>
          )}
        </div>
        {!collapsed && (
          <p className="text-[13px] text-[#e7e9ea] mt-0.5 leading-relaxed">
            {text}
          </p>
        )}
      </div>
      {!collapsed &&
        childCount > 0 &&
        comment.children.map((child) => (
          <CommentThread key={child.id} comment={child} depth={depth + 1} />
        ))}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[13px] font-medium px-3 py-1.5 rounded-full transition-colors ${
        active
          ? "bg-white text-black"
          : "text-muted hover:text-white hover:bg-white/[0.05]"
      }`}
    >
      {children}
    </button>
  );
}
