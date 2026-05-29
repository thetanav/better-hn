import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, MessageCircle, RefreshCw, Settings, Share } from "lucide-react";
import {
  type Mode,
  type Story,
  type Profile,
  FEED_URL,
  fallbackStories,
  loadProfile,
  saveProfile,
  normalizeStory,
  rankStories,
  scoreStory,
  trendingScore,
  recordSignal as recordSignalFn,
  timeAgo,
} from "./recommendation";

export default function App() {
  const [mode, setMode] = useState<Mode>("for-you");
  const [stories, setStories] = useState<Story[]>([]);
  const [statusText, setStatusText] = useState("Loading...");
  const [selected, setSelected] = useState<Story | null>(null);
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [liked, setLiked] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("liked-stories") || "{}");
    } catch {
      return {};
    }
  });
  const [imageOverrides, setImageOverrides] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;

    async function loadFeed() {
      setStatusText("Loading...");
      try {
        const res = await fetch(FEED_URL);
        const data = await res.json();
        if (cancelled) return;
        const nextStories = (data.hits || [])
          .map(normalizeStory)
          .filter((story: Story) => story.title);
        setStories(nextStories);
        setStatusText(`${nextStories.length} stories`);
      } catch {
        if (cancelled) return;
        setStories(fallbackStories());
        setStatusText("Offline");
      }
    }

    void loadFeed();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  const avgDwell = profile.views
    ? Math.round(profile.dwellTotal / profile.views)
    : 0;

  const rankedStories = useMemo(
    () => rankStories(stories, mode, profile, avgDwell),
    [mode, profile, stories, avgDwell],
  );

  // Persist liked map
  useEffect(() => {
    try {
      localStorage.setItem("liked-stories", JSON.stringify(liked));
    } catch {}
  }, [liked]);

  // Helper: generate a small SVG placeholder data URI when image fails
  function svgPlaceholder(text: string) {
    const escaped = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'><rect width='100%' height='100%' fill='#0f172a'/><text x='50%' y='50%' fill='#94a3b8' font-family='Inter,system-ui,sans-serif' font-size='36' dominant-baseline='middle' text-anchor='middle'>${escaped}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  // Try to fetch an Open Graph image by fetching the page HTML via a public text proxy and extracting og:image
  async function tryFetchOgImage(story: Story) {
    if (!story.url) return;
    try {
      // Use jina.ai text proxy which returns the page contents as text; if blocked this will fail and we fallback
      const proxyUrl =
        "https://r.jina.ai/http://" + story.url.replace(/^https?:\/\//, "");
      const res = await fetch(proxyUrl, { cache: "force-cache" });
      if (!res.ok) return;
      const text = await res.text();
      const m =
        text.match(
          /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
        ) ||
        text.match(
          /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i,
        );
      if (m && m[1]) {
        setImageOverrides((s) => ({ ...s, [story.id]: m[1] }));
      }
    } catch {
      // ignore; leave fallback
    }
  }

  // Observe which card is active using IntersectionObserver
  useEffect(() => {
    const ids = rankedStories.map((s) => s.id);
    let currentActive: string | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        // find the entry with highest intersectionRatio
        entries.forEach((entry) => {
          const id = entry.target.getAttribute("data-id") || "";
          if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
            // become active
            if (currentActive !== id) {
              currentActive = id;
              const idx = ids.indexOf(id);
              setActiveIndex(idx >= 0 ? idx : 0);
              const story = rankedStories[idx];
              if (story) {
                setSelected(story);
                // attempt OG fetch if we don't already have an image
                if (!story.image && !imageOverrides[story.id])
                  void tryFetchOgImage(story);
              }
            }
          }
        });
      },
      { threshold: [0.35, 0.55, 0.75] },
    );

    // observe elements
    rankedStories.forEach((s) => {
      const el = cardRefs.current[s.id];
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedStories]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        const next = Math.min(rankedStories.length - 1, activeIndex + 1);
        const id = rankedStories[next]?.id;
        const el = id ? cardRefs.current[id] : null;
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        const prev = Math.max(0, activeIndex - 1);
        const id = rankedStories[prev]?.id;
        const el = id ? cardRefs.current[id] : null;
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, rankedStories]);

  function toggleLike(story: Story) {
    setLiked((l) => {
      const next = { ...l, [story.id]: !l[story.id] };
      // If the story is being liked (turned on), record a stronger signal (2x boost)
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
        alert("Link copied to clipboard");
      }
    } catch (err) {
      // ignore
    }
  }

  function openStory(story: Story) {
    setSelected(story);
    // Record an 'open' signal immediately (click = 1x)
    setProfile((p) => recordSignalFn(story, "open", 1, 0, p));
    // Open the story URL in a new tab so clicking the card behaves like "open in new tab"
    try {
      const win = window.open(story.url, "_blank");
      if (win) win.opener = null; // prevent the opened page from accessing our window
    } catch (err) {
      // ignore if popup blocked or other errors
    }
  }

  function resetScores() {
    setProfile({
      topics: {},
      views: 0,
      dwellTotal: 0,
      deepReads: 0,
      signals: [],
    });
  }

  const topicChips = useMemo((): [string, number][] => {
    const entries = Object.entries(profile.topics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return entries.length ? entries : [["—", 0]];
  }, [profile.topics]);

  function authorInitials(author?: string) {
    if (!author) return "?";
    const parts = author.split(/\s+/).filter(Boolean);
    const chars = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "");
    return chars.join("") || author[0]?.toUpperCase() || "?";
  }

  function authorHandle(author?: string) {
    if (!author) return "@unknown";
    return `@${author.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "user"}`;
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Left sidebar */}
        <aside className="hidden xl:block border-r border-border px-4 py-3">
          <div className="py-3">
            <span className="text-xl font-bold tracking-tight">Better HN</span>
          </div>

          <div className="mt-4 border border-border rounded-xl p-4">
            <div className="text-[13px] font-medium text-white mb-3">
              Your profile
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topicChips.map(([topic, score]) => (
                <span
                  key={topic}
                  className="bg-surface border border-border rounded-full px-3 py-1 text-[13px] text-[#e7e9ea]"
                >
                  {topic} {score ? score.toFixed(1) : ""}
                </span>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Metric value={`${avgDwell}s`} label="avg dwell" />
              <Metric value={`${profile.deepReads}`} label="deep reads" />
              <Metric value={`${profile.views}`} label="views" />
              <Metric value={`${profile.signals.length}`} label="signals" />
            </div>
          </div>

          <div className="mt-3 px-1 text-[13px] text-muted leading-relaxed">
            {mode === "for-you"
              ? "Ranking blends freshness, popularity, and your reading signals."
              : "Showing stories ranked by HN engagement."}
          </div>
        </aside>

        {/* Main feed */}
        <main className="border-r border-border min-w-0">
          <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="xl:hidden text-lg font-bold tracking-tight mr-2">
                Better HN
              </span>
              <div className="px-4 py-2 text-[13px] text-muted">
                {rankedStories.length} · {statusText}
              </div>
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
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-1.5 text-[13px] text-accent hover:text-white px-2 py-1 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-1.5 text-[13px] text-muted hover:text-white px-2 py-1 transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </header>

          {/* Twitter-like vertical feed */}
          <div className="divide-y divide-border">
            {rankedStories.map((story, idx) => {
              const genreScore = profile.topics[story.topic] || 0;
              const isSelected = selected?.id === story.id;
              return (
                <article
                  key={story.id}
                  data-id={story.id}
                  ref={(el) => {
                    cardRefs.current[story.id] = el;
                  }}
                  onClick={() => openStory(story)}
                  className={`cursor-pointer transition-colors px-4 py-4 ${isSelected ? "bg-white/[0.04]" : ""}`}
                >
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-semibold text-white border border-white/40">
                      {authorInitials(story.author)}
                    </div>

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
                        src={`https://picsum.photos/1200/800`}
                        alt="story"
                        className="mt-3 h-96 w-full rounded-2xl border border-border object-cover"
                      />

                      <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className="flex items-center gap-2 hover:text-white transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>{story.comments}</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className="flex items-center gap-2 hover:text-white transition-colors"
                        >
                          <RefreshCw className="w-4 h-4" />
                          <span>{genreScore.toFixed(1)}</span>
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
                          <span>
                            {story.points + (liked[story.id] ? 1 : 0)}
                          </span>
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
        </main>

        {/* Right panel */}
        <aside className="hidden xl:block">
          {selected ? (
            <div className="sticky top-0 p-4">
              <div className="border border-border rounded-xl p-4">
                <div className="text-[13px] text-accent font-medium">
                  {selected.topic}
                </div>
                <h3 className="text-lg font-bold text-white mt-1 leading-snug">
                  {selected.title}
                </h3>
                <p className="text-[13px] text-muted mt-2">
                  {selected.author} · {selected.points} points ·{" "}
                  {selected.comments} comments
                </p>
                <p className="text-[14px] text-[#e7e9ea] mt-3 leading-relaxed">
                  {selected.excerpt || "No excerpt available."}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-accent text-white text-[13px] font-bold rounded-full px-4 py-2 hover:bg-accent/90 transition-colors"
                  >
                    Read
                  </a>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="border border-border rounded-xl p-4">
                <div className="text-[15px] font-bold text-white">
                  Select a story
                </div>
                <p className="text-[13px] text-muted mt-1">
                  Click a story to inspect it and track your reading behavior.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
      {showSettings ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-black p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold text-white">
                Settings
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-[13px] text-muted hover:text-white"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-[13px] text-muted">
              Manage scoring and reset your genre preferences.
            </p>
            <button
              onClick={() => {
                resetScores();
                setShowSettings(false);
              }}
              className="mt-4 w-full rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent/90 transition-colors"
            >
              Reset all scores
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-black border border-border rounded-lg p-2.5">
      <span className="block text-[15px] font-bold text-white">{value}</span>
      <span className="text-[11px] text-muted uppercase tracking-wider">
        {label}
      </span>
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
