// Mirrors the JSON produced by backend/app/services/city.py

export interface Building {
  id: string
  path: string
  name: string
  district: string
  zone: string
  ext: string
  language: string
  languageColor: string
  iconSlug: string
  archetype: string
  archetypeLabel: string
  accent: string
  floors: number
  seed: number
  rotation: number
  color: string
  roofColor: string
  x: number
  z: number
  width: number
  depth: number
  height: number
  roof: string
  role: string
  importance: number
  loc: number
  bytes: number
  isLandmark: boolean
  headline: string
  summary: string
  detail: string
  tags: string[]
  keySymbols: string[]
  connectsTo: string[]
  ai: boolean
  githubUrl: string
}

export interface District {
  id: string
  path: string
  name: string
  purpose: string
  zone: string
  ground: string
  grass: boolean
  x: number
  z: number
  width: number
  depth: number
  color: string
  fileCount: number
  buildingIds: string[]
}

export interface TechEntry {
  name: string
  slug: string
  role: string
}

export interface ProjectBrief {
  tagline: string
  overview: string
  architecture: string
  tech_stack: TechEntry[]
  highlights: string[]
  entry_points: string[]
  districts: { path: string; name: string; purpose: string }[]
  how_it_works: { step: string; detail: string }[]
  getting_started: string
  ai?: boolean
}

export interface RepoMeta {
  slug: string
  name: string
  owner: string
  url: string
  branch: string
  description: string
  stars: number
  forks: number
  openIssues: number
  license: string
  topics: string[]
  homepage: string
  pushedAt: string
}

export interface CityStats {
  buildings: number
  districts: number
  totalLoc: number
  languages: Record<string, number>
  buildingTypes: Record<string, number>
  repoLanguages: Record<string, number>
  landmarkId: string
  filesInRepo: number
  filesConsidered: number
  filesReadByAI: number
  aiEnabled: boolean
  llmCalls: number
  inputTokens: number
  outputTokens: number
  treeTruncated: boolean
  warnings: string[]
  seedTech: string[]
}

export interface Road {
  x: number
  z: number
  length: number
  width: number
  axis: 'x' | 'z'
}

export interface Prop {
  type: string
  x: number
  z: number
  rotation: number
  scale: number
  color: string
}

export interface CityData {
  repo: RepoMeta
  project: ProjectBrief
  districts: District[]
  buildings: Building[]
  roads: Road[]
  props: Prop[]
  entrance: { x: number; z: number; scale?: number; road?: number }
  bounds: { width: number; depth: number }
  stats: CityStats
}

export interface JobSnapshot {
  id: string
  repoUrl: string
  status: 'queued' | 'running' | 'done' | 'error'
  stage: string
  progress: number
  error: string
  log: { t: number; stage: string }[]
  result?: CityData
}

export interface AuthUser {
  authenticated: boolean
  login?: string
  name?: string
  avatarUrl?: string
  htmlUrl?: string
  bio?: string
  publicRepos?: number
}

export interface GithubRepo {
  name: string
  fullName: string
  description: string
  url: string
  language: string
  stars: number
  forks: number
  private: boolean
  pushedAt: string
}

export interface ContributionDay {
  date: string
  count: number
}

export interface ProfileStats {
  followers: number
  following: number
  totalCommits: number
  totalPullRequests: number
  totalIssues: number
  totalContributionsLastYear: number
  totalStars: number
  calendar: ContributionDay[]
}

export interface ProfileData {
  user: AuthUser
  repos: GithubRepo[]
  stats: ProfileStats
}

export interface RecentCity {
  slug: string
  url: string
  description: string
  buildings: number
  cacheKey: string
  cachedAt: number
}
