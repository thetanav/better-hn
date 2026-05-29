import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, MessageCircle, RefreshCw, Search, Settings, Share, Sparkles } from "lucide-react";
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
  scoreStory,
  trendingScore,
  recordSignal as recordSignalFn,
  fetchCommentTree,
  stripHtml,
  timeAgo,
} from "./recommendation";

export default function App() {
  const [mode, setMode] = useState<Mode>("for-you");

  const {
    data: stories = [],
    isLoading: feedLoading,
    refetch: refetchFeed,
  } = useQuery({
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

  const statusText = feedLoading ? "Loading..." : `${stories.length} stories`;
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
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    data: searchResults = [],
    isFetching: searching,
  } = useQuery<Story[]>({
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
  });
  const [showComments, setShowComments] = useState(false);
  const [commentStory, setCommentStory] = useState<Story | null>(null);

  const {
    data: commentTree = [],
    isLoading: commentsLoading,
  } = useQuery({
    queryKey: ["hn-comments", commentStory?.id],
    queryFn: async () => {
      if (!commentStory) return [];
      return fetchCommentTree(commentStory.id);
    },
    enabled: showComments && !!commentStory,
    staleTime: 2 * 60 * 1000,
  });

  // --- Crazy features ---
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  function readingTime(text?: string) {
    if (!text) return null;
    const wpm = 200;
    const words = text.split(/\s+/).length;
    const min = Math.ceil(words / wpm);
    return min < 1 ? "<1 min" : `${min} min read`;
  }

  function surpriseMe() {
    if (rankedStories.length === 0) return;
    const idx = Math.floor(Math.random() * rankedStories.length);
    const id = rankedStories[idx].id;
    const el = cardRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
      setActiveIndex(idx);
      setSelected(rankedStories[idx]);
    }
  }

  function burstConfetti() {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cvs = canvas;
    const c = ctx;
    const colors = ["#ff6600", "#ff3366", "#00ccff", "#ffcc00", "#33ff99", "#9933ff"];
    const particles: Array<{ x: number; y: number; vx: number; vy: number; color: string; size: number; life: number; rotation: number }> = [];
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 16 + 4;
      particles.push({
        x: cvs.width / 2,
        y: cvs.height / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 7 + 3,
        life: 1,
        rotation: Math.random() * 360,
      });
    }
    function frame() {
      c.clearRect(0, 0, cvs.width, cvs.height);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.vx *= 0.98;
        p.life -= 0.015;
        p.rotation += 5;
        c.globalAlpha = Math.max(0, p.life);
        c.save();
        c.translate(p.x, p.y);
        c.rotate((p.rotation * Math.PI) / 180);
        c.fillStyle = p.color;
        c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        c.restore();
      }
      c.globalAlpha = 1;
      if (alive) requestAnimationFrame(frame);
    }
    frame();
  }

  // Track scroll progress
  useEffect(() => {
    function onScroll() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? Math.min(1, scrollTop / docHeight) : 0);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  const avgDwell = profile.views
    ? Math.round(profile.dwellTotal / profile.views)
    : 0;

  const rankedStories = useMemo(() => {
    const ranked = rankStories(stories, mode, profile, avgDwell);
    return topicFilter ? ranked.filter((s) => s.topic === topicFilter) : ranked;
  }, [mode, profile, stories, avgDwell, topicFilter]);

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
                // attempt OG fetch if we don't already have an override
                if (!imageOverrides[story.id])
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
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      } else if (e.key === "/") {
        e.preventDefault();
        setShowSearch(true);
        setSearchQuery("");
      } else if (e.key === "Escape") {
        if (showSearch) setShowSearch(false);
        if (showComments) setShowComments(false);
        if (showShortcuts) setShowShortcuts(false);
      } else if (!showSearch && !showComments && (e.key === "ArrowDown" || e.key === "PageDown")) {
        const next = Math.min(rankedStories.length - 1, activeIndex + 1);
        const id = rankedStories[next]?.id;
        const el = id ? cardRefs.current[id] : null;
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else if (!showSearch && !showComments && (e.key === "ArrowUp" || e.key === "PageUp")) {
        const prev = Math.max(0, activeIndex - 1);
        const id = rankedStories[prev]?.id;
        const el = id ? cardRefs.current[id] : null;
        if (el) el.scrollIntoView({ behavior: "smooth" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, rankedStories, showSearch, showComments, showShortcuts]);

  function toggleLike(story: Story) {
    setLiked((l) => {
      const next = { ...l, [story.id]: !l[story.id] };
      // If the story is being liked (turned on), record a stronger signal (2x boost)
      if (!l[story.id]) {
        setProfile((p) => recordSignalFn(story, "open", 2, 0, p));
        burstConfetti();
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
    <div className="min-h-screen bg-black relative">
      {/* Animated ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 rounded-full bg-accent/5 blur-[120px] animate-float" />
        <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 rounded-full bg-[#3366ff]/5 blur-[120px] animate-float" style={{ animationDelay: "-6s" }} />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-1/3 h-1/3 rounded-full bg-[#ff3366]/5 blur-[100px] animate-pulse-glow" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black" />
      </div>
      {/* Confetti canvas */}
      <canvas
        ref={confettiCanvasRef}
        className="fixed inset-0 pointer-events-none z-[60]"
        width={window.innerWidth}
        height={window.innerHeight}
      />

      <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_340px] relative z-10">
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
            <div className="px-4 py-2 flex items-center justify-between gap-2">
              <span className="xl:hidden text-lg font-bold tracking-tight shrink-0">
                Better HN
              </span>
              <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
                {/* Topic filters */}
                {Array.from(new Set(rankedStories.map((s) => s.topic))).slice(0, 6).map((topic) => (
                  <button
                    key={topic}
                    onClick={() => setTopicFilter(topicFilter === topic ? null : topic)}
                    className={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                      topicFilter === topic
                        ? "bg-accent text-white"
                        : "bg-surface/50 text-muted border border-border hover:text-white"
                    }`}
                  >
                    {topic}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <div className="text-[12px] text-muted mr-1 hidden md:block">
                  {rankedStories.length} · {statusText}
                </div>
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
                  onClick={surpriseMe}
                  title="Surprise me"
                  className="flex items-center gap-1.5 text-[13px] text-muted hover:text-accent px-2 py-1 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { setShowSearch(true); setSearchQuery(""); }}
                  className="flex items-center gap-1.5 text-[13px] text-muted hover:text-white px-2 py-1 transition-colors"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
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
                        {readingTime(story.excerpt) && (
                          <>
                            <span>·</span>
                            <span className="text-[#33ff99]/70">{readingTime(story.excerpt)}</span>
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
                        src={imageOverrides[story.id] || story.image || svgPlaceholder(story.title)}
                        alt={story.title}
                        className="mt-3 h-96 w-full rounded-2xl border border-border object-cover"
                        onError={(e) => {
                          if ((e.target as HTMLImageElement).src !== svgPlaceholder(story.title)) {
                            (e.target as HTMLImageElement).src = svgPlaceholder(story.title);
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
      {showSearch ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[15vh]"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSearch(false); }}
        >
          <div className="w-full max-w-xl rounded-2xl border border-border bg-black shadow-xl overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="w-4 h-4 text-muted shrink-0" />
              <input
                ref={searchInputRef}
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
                <div className="px-4 py-8 text-center text-[13px] text-muted">Searching...</div>
              ) : searchQuery && searchResults.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">No results found</div>
              ) : !searchQuery ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">Type to search HN stories</div>
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
                      <span className="text-white font-medium text-[13px]">{result.author}</span>
                      <span>·</span>
                      <span>{timeAgo(result.createdTs)}</span>
                      {result.domain && <><span>·</span><span className="text-accent">{result.domain}</span></>}
                    </div>
                    <div className="text-[14px] text-white font-medium mt-0.5 line-clamp-2">{result.title}</div>
                    <div className="flex items-center gap-3 text-[12px] text-muted mt-1">
                      <span>{result.points} points</span>
                      <span>{result.comments} comments</span>
                      <span className="bg-surface border border-border rounded-full px-2 py-0.5 text-[11px]">{result.topic}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
      {showComments ? (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-end"
          onClick={(e) => { if (e.target === e.currentTarget) setShowComments(false); }}
        >
          <div className="w-full max-w-2xl mx-auto bg-black border border-border rounded-t-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <span className="text-[15px] font-semibold text-white">Comments</span>
                {commentStory && (
                  <span className="text-[13px] text-muted ml-2">on {commentStory.title.slice(0, 60)}</span>
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
                <div className="text-center text-[13px] text-muted py-8">Loading comments...</div>
              ) : commentTree.length === 0 ? (
                <div className="text-center text-[13px] text-muted py-8">No comments yet</div>
              ) : (
                commentTree.map((c) => <CommentThread key={c.id} comment={c} depth={0} />)
              )}
            </div>
          </div>
        </div>
      ) : null}
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

      {/* Scroll-to-top button with progress ring */}
      {scrollProgress > 0.05 && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 w-12 h-12 flex items-center justify-center rounded-full bg-surface border border-border hover:border-accent transition-all hover:scale-110"
        >
          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
            <circle
              cx="50" cy="50" r="44" fill="none" stroke="#ff6600" strokeWidth="3"
              strokeDasharray={276.46}
              strokeDashoffset={276.46 * (1 - scrollProgress)}
              strokeLinecap="round"
              className="transition-all duration-200"
            />
          </svg>
          <span className="text-[16px] font-bold text-white relative z-10">↑</span>
        </button>
      )}

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowShortcuts(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-black p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[15px] font-semibold text-white">Keyboard shortcuts</span>
              <button onClick={() => setShowShortcuts(false)} className="text-[13px] text-muted hover:text-white">Close</button>
            </div>
            <div className="space-y-2.5 text-[13px]">
              <div className="flex justify-between"><span className="text-muted">Search</span><kbd className="bg-surface border border-border rounded px-2 py-0.5 text-[12px]">/</kbd></div>
              <div className="flex justify-between"><span className="text-muted">Next story</span><kbd className="bg-surface border border-border rounded px-2 py-0.5 text-[12px]">↓</kbd></div>
              <div className="flex justify-between"><span className="text-muted">Previous story</span><kbd className="bg-surface border border-border rounded px-2 py-0.5 text-[12px]">↑</kbd></div>
              <div className="flex justify-between"><span className="text-muted">Close modals</span><kbd className="bg-surface border border-border rounded px-2 py-0.5 text-[12px]">Esc</kbd></div>
              <div className="flex justify-between"><span className="text-muted">This cheat sheet</span><kbd className="bg-surface border border-border rounded px-2 py-0.5 text-[12px]">?</kbd></div>
            </div>
          </div>
        </div>
      )}
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

function CommentThread({ comment, depth }: { comment: Comment; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth > 0);
  const text = comment.text ? stripHtml(comment.text).slice(0, 600) : "[deleted]";
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
      {!collapsed && childCount > 0 &&
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
