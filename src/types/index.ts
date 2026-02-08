export interface Character {
  mal_id: number;
  jikan_id?: number | null;
  name: string;
  images: {
    jpg: {
      image_url: string;
    };
  };
  customImageUrl?: string;
  source?: string;
}

export interface GridCell {
  character: Character | null;
}

export interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

export interface AnalysisResult {
  emoji: string;
  en: { title: string; content: string; tags: string[] };
  th: { title: string; content: string; tags: string[] };
}

export type VerdictFeedback = 'agree' | 'disagree' | null;
