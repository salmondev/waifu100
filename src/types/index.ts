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
