export const STORAGE_KEY = 'hn-threader-state-v1';
export const FEED_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=50';

export const TOPIC_KEYWORDS: Record<string, string[]> = {
  ai: ['ai', 'ml', 'model', 'llm', 'gpu', 'neural', 'openai', 'anthropic', 'inference'],
  startup: ['startup', 'founder', 'funding', 'vc', 'revenue', 'product', 'launch'],
  security: ['security', 'vulnerability', 'cve', 'exploit', 'auth', 'crypto', 'encryption'],
  devtools: ['git', 'compiler', 'debugger', 'editor', 'framework', 'library', 'runtime', 'cli'],
  systems: ['linux', 'kernel', 'memory', 'cpu', 'database', 'distributed', 'network', 'storage'],
  design: ['ui', 'ux', 'design', 'interface', 'visual', 'css', 'animation'],
  science: ['science', 'research', 'paper', 'study', 'biology', 'physics', 'math', 'chemistry'],
  business: ['market', 'business', 'economy', 'policy', 'regulation', 'industry'],
};

export type Mode = 'for-you' | 'trending';
export type SignalKind = 'open' | 'deep-read';

export type Story = {
  id: string;
  title: string;
  author: string;
  url: string;
  points: number;
  comments: number;
  createdAt: string;
  createdTs: number;
  domain: string;
  topic: string;
  excerpt: string;
  image?: string;
};

export type Signal = {
  storyId: string;
  topic: string;
  kind: SignalKind;
  dwell: number;
  weight: number;
  ts: number;
};

export type Profile = {
  topics: Record<string, number>;
  views: number;
  dwellTotal: number;
  deepReads: number;
  signals: Signal[];
};

// --- Utility helpers ---

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '');
}

export function domainFromUrl(url?: string) {
  if (!url) return 'news.ycombinator.com';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'news.ycombinator.com';
  }
}

export function timeAgo(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// --- Topic classification ---

export function inferTopic(text: string) {
  const lower = text.toLowerCase();
  let best = 'general';
  let bestCount = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const count = keywords.reduce((sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0), 0);
    if (count > bestCount) {
      best = topic;
      bestCount = count;
    }
  }
  return best;
}

// --- Story normalization ---

export function normalizeStory(hit: any): Story {
  const topic = inferTopic(`${hit.title || ''} ${hit.url || ''} ${hit.author || ''}`);
  const domain = domainFromUrl(hit.url);
  // Try to provide a representative image. Many HN links don't include images in the API,
  // so we use the site's logo via Clearbit as a lightweight proxy. It's optional.
  const image = hit.image || (domain ? `https://logo.clearbit.com/${domain}` : undefined);
  return {
    id: hit.objectID,
    title: hit.title,
    author: hit.author || 'unknown',
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    points: hit.points || 0,
    comments: hit.num_comments || 0,
    createdAt: hit.created_at,
    createdTs: new Date(hit.created_at).getTime(),
    domain,
    topic,
    excerpt: hit.story_text ? stripHtml(hit.story_text).slice(0, 180) : '',
    image,
  };
}

// --- Offline fallback ---

export function fallbackStories(): Story[] {
  const now = Date.now();
  return [
    { id: '1', title: 'Why developers are shipping smaller AI products', author: 'sara', url: 'https://news.ycombinator.com/', points: 312, comments: 88, createdAt: new Date(now - 2 * 36e5).toISOString(), createdTs: now - 2 * 36e5, domain: 'example.com', topic: 'ai', excerpt: 'A small product can still have a powerful model loop.', image: 'https://images.unsplash.com/photo-1526378726363-8a9f4d7f2b39?w=1200&auto=format&fit=crop' },
    { id: '2', title: 'How a tiny terminal UI won over a large team', author: 'mike', url: 'https://news.ycombinator.com/', points: 204, comments: 51, createdAt: new Date(now - 6 * 36e5).toISOString(), createdTs: now - 6 * 36e5, domain: 'example.com', topic: 'devtools', excerpt: 'A deep dive into shipping faster with good interfaces.', image: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?w=1200&auto=format&fit=crop' },
    { id: '3', title: 'A systems lesson from a database outage', author: 'anya', url: 'https://news.ycombinator.com/', points: 188, comments: 62, createdAt: new Date(now - 10 * 36e5).toISOString(), createdTs: now - 10 * 36e5, domain: 'example.com', topic: 'systems', excerpt: 'Reliability is mostly about removing assumptions.', image: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1200&auto=format&fit=crop' },
  ];
}

// --- Profile persistence ---

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    // ignore
  }
  return { topics: {}, views: 0, dwellTotal: 0, deepReads: 0, signals: [] };
}

export function saveProfile(profile: Profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

// --- Comment types ---

export type Comment = {
  id: number;
  author: string;
  text: string;
  created_at: string;
  children: Comment[];
  points?: number;
};

export async function fetchCommentTree(storyId: string): Promise<Comment[]> {
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/items/${storyId}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.children || [];
  } catch {
    return [];
  }
}

// --- Scoring algorithms ---

export function readingBias(topic: string, profile: Profile, avgDwell: number) {
  const count = profile.signals.filter((signal) => signal.topic === topic).length;
  return count * 4 + Math.min(12, avgDwell / 2);
}

export function scoreStory(story: Story, profile: Profile, avgDwell: number) {
  const ageHours = Math.max(1, (Date.now() - story.createdTs) / 36e5);
  const freshness = 18 / (ageHours + 6);
  const popularity = Math.log10((story.points || 1) + (story.comments || 0) + 1) * 18;
  const relevance = (profile.topics[story.topic] || 0) * 8;
  return freshness + popularity + relevance + readingBias(story.topic, profile, avgDwell);
}

export function trendingScore(story: Story) {
  const ageHours = Math.max(1, (Date.now() - story.createdTs) / 36e5);
  return story.points * 2.4 + story.comments * 1.6 + 26 / (ageHours + 2);
}

// --- Signal tracking ---

export function topicInterest(topic: string, weight: number, dwell: number) {
  const dwellBonus = Math.min(4, dwell / 8);
  return weight + dwellBonus + 0.5;
}

export function recordSignal(
  story: Story,
  kind: SignalKind,
  weight: number,
  readStart: number,
  profile: Profile,
): Profile {
  const dwell = kind === 'open' ? 0 : Math.max(1, Math.round((performance.now() - readStart) / 1000));
  const interest = topicInterest(story.topic, weight, dwell);

  return {
    ...profile,
    topics: {
      ...profile.topics,
      [story.topic]: (profile.topics[story.topic] || 0) + interest,
    },
    views: profile.views + 1,
    dwellTotal: profile.dwellTotal + dwell,
    deepReads: profile.deepReads + (dwell >= 18 || kind === 'deep-read' ? 1 : 0),
    signals: [...profile.signals, { storyId: story.id, topic: story.topic, kind, dwell, weight, ts: Date.now() }],
  };
}

// --- Ranking ---

export function rankStories(stories: Story[], mode: Mode, profile: Profile, avgDwell: number): Story[] {
  const list = [...stories];
  if (mode === 'trending') {
    return list.sort((a, b) => trendingScore(b) - trendingScore(a));
  }
  return list.sort((a, b) => scoreStory(b, profile, avgDwell) - scoreStory(a, profile, avgDwell));
}
