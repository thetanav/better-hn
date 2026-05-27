import { useEffect, useMemo, useState } from 'react';
import { Heart, MessageCircle, RefreshCw } from 'lucide-react';
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
} from './recommendation';

export default function App() {
  const [mode, setMode] = useState<Mode>('for-you');
  const [stories, setStories] = useState<Story[]>([]);
  const [statusText, setStatusText] = useState('Loading...');
  const [selected, setSelected] = useState<Story | null>(null);
  const [readStart, setReadStart] = useState(0);
  const [profile, setProfile] = useState<Profile>(() => loadProfile());

  useEffect(() => {
    let cancelled = false;

    async function loadFeed() {
      setStatusText('Loading...');
      try {
        const res = await fetch(FEED_URL);
        const data = await res.json();
        if (cancelled) return;
        const nextStories = (data.hits || []).map(normalizeStory).filter((story: Story) => story.title);
        setStories(nextStories);
        setStatusText(`${nextStories.length} stories`);
      } catch {
        if (cancelled) return;
        setStories(fallbackStories());
        setStatusText('Offline');
      }
    }

    void loadFeed();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);

  const avgDwell = profile.views ? Math.round(profile.dwellTotal / profile.views) : 0;

  const rankedStories = useMemo(() => rankStories(stories, mode, profile, avgDwell), [mode, profile, stories, avgDwell]);

  function openStory(story: Story) {
    setSelected(story);
    setReadStart(performance.now());
    setProfile((p) => recordSignalFn(story, 'open', 1, readStart, p));
  }

  function markDeepRead() {
    if (!selected) return;
    setProfile((p) => recordSignalFn(selected, 'deep-read', 1.5, readStart, p));
  }

  const topicChips = useMemo((): [string, number][] => {
    const entries = Object.entries(profile.topics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return entries.length ? entries : [['—', 0]];
  }, [profile.topics]);

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_340px]">

        {/* Left sidebar */}
        <aside className="hidden xl:block border-r border-border px-4 py-3">
          <div className="py-3">
            <span className="text-xl font-bold tracking-tight">Better HN</span>
          </div>

          <div className="mt-4 border border-border rounded-xl p-4">
            <div className="text-[13px] font-medium text-white mb-3">Your profile</div>
            <div className="flex flex-wrap gap-1.5">
              {topicChips.map(([topic, score]) => (
                <span key={topic} className="bg-surface border border-border rounded-full px-3 py-1 text-[13px] text-[#e7e9ea]">
                  {topic} {score ? score.toFixed(1) : ''}
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
            {mode === 'for-you'
              ? 'Ranking blends freshness, popularity, and your reading signals.'
              : 'Showing stories ranked by HN engagement.'}
          </div>
        </aside>

        {/* Main feed */}
        <main className="border-r border-border min-w-0">
          <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-md border-b border-border">
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="xl:hidden text-lg font-bold tracking-tight mr-2">Better HN</span>
                <h2 className="text-[15px] font-bold text-white m-0">{mode === 'for-you' ? 'For you' : 'Trending'}</h2>
              </div>
              <div className="flex items-center gap-1">
                <Tab active={mode === 'for-you'} onClick={() => setMode('for-you')}>For you</Tab>
                <Tab active={mode === 'trending'} onClick={() => setMode('trending')}>Trending</Tab>
                <div className="w-px h-4 bg-border mx-1" />
                <button
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-1.5 text-[13px] text-accent hover:text-white px-2 py-1 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Refresh
                </button>
              </div>
            </div>
          </header>

          <div className="px-4 py-2 text-[13px] text-muted border-b border-border">
            {rankedStories.length} stories · {statusText}
          </div>

          <div>
            {rankedStories.map((story) => {
              const score = mode === 'trending' ? trendingScore(story) : scoreStory(story, profile, avgDwell);
              const isSelected = selected?.id === story.id;
              return (
                <article
                  key={story.id}
                  onClick={() => openStory(story)}
                  className={`px-4 py-3 border-b border-border cursor-pointer transition-colors hover:bg-white/[0.03] ${isSelected ? 'bg-white/[0.05]' : ''}`}
                >
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[13px] text-muted">
                        <span className="text-white font-medium">{story.author}</span>
                        <span>·</span>
                        <span>{timeAgo(story.createdTs)}</span>
                        <span>·</span>
                        <span>{story.domain}</span>
                      </div>
                      <h3 className="text-[15px] font-medium text-white mt-0.5 leading-snug">{story.title}</h3>
                      {story.excerpt && (
                        <p className="text-[13px] text-muted mt-1 line-clamp-2">{story.excerpt}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-[13px] text-muted">
                        <span className="flex items-center gap-1">
                          <Heart className="w-4 h-4" />
                          {story.points}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="w-4 h-4" />
                          {story.comments}
                        </span>
                        <span className="text-accent font-medium">{Math.round(score)}</span>
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
                <div className="text-[13px] text-accent font-medium">{selected.topic}</div>
                <h3 className="text-lg font-bold text-white mt-1 leading-snug">{selected.title}</h3>
                <p className="text-[13px] text-muted mt-2">
                  {selected.author} · {selected.points} points · {selected.comments} comments
                </p>
                <p className="text-[14px] text-[#e7e9ea] mt-3 leading-relaxed">
                  {selected.excerpt || 'No excerpt available.'}
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
                  <button
                    onClick={markDeepRead}
                    className="border border-border text-[13px] font-medium rounded-full px-4 py-2 text-white hover:bg-white/[0.05] transition-colors"
                  >
                    Deep read
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="border border-border rounded-xl p-4">
                <div className="text-[15px] font-bold text-white">Select a story</div>
                <p className="text-[13px] text-muted mt-1">
                  Click a story to inspect it and track your reading behavior.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-black border border-border rounded-lg p-2.5">
      <span className="block text-[15px] font-bold text-white">{value}</span>
      <span className="text-[11px] text-muted uppercase tracking-wider">{label}</span>
    </div>
  );
}

function Tab({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-[13px] font-medium px-3 py-1.5 rounded-full transition-colors ${
        active ? 'bg-white text-black' : 'text-muted hover:text-white hover:bg-white/[0.05]'
      }`}
    >
      {children}
    </button>
  );
}
