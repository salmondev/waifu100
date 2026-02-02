import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock environment variables
process.env.SERPER_API_KEY = "test-api-key";
process.env.GEMINI_API_KEY = "test-gemini-key";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Google Generative AI
vi.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn().mockResolvedValue({
        response: {
          text: () => "Rem Re:Zero anime character official art",
        },
      }),
    }),
  })),
}));

describe("Serper Images API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should return images from Serper API", async () => {
    const mockSerperResponse = {
      images: [
        {
          title: "Rem from Re:Zero",
          imageUrl: "https://example.com/rem.jpg",
          thumbnailUrl: "https://example.com/rem-thumb.jpg",
          domain: "example.com",
        },
        {
          title: "Rem Official Art",
          imageUrl: "https://example.com/rem2.jpg",
          thumbnailUrl: "https://example.com/rem2-thumb.jpg",
          domain: "fanart.com",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSerperResponse),
    });

    // Import dynamically to allow mocking
    const { POST } = await import("./route");

    const request = {
      json: () =>
        Promise.resolve({
          characterName: "Rem",
          animeSource: "Re:Zero",
        }),
    } as Request;

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.images).toHaveLength(2);
    expect(data.images[0].url).toBe("https://example.com/rem.jpg");
    expect(data.images[0].source).toContain("Serper");
  });

  it("should return 400 if no character name provided", async () => {
    const { POST } = await import("./route");

    const request = {
      json: () => Promise.resolve({}),
    } as Request;

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Character name or query required");
  });

  it("should handle Serper API errors gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const { POST } = await import("./route");

    const request = {
      json: () =>
        Promise.resolve({
          characterName: "Rem",
        }),
    } as Request;

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain("Serper API error");
  });

  it("should use direct query when provided", async () => {
    const mockSerperResponse = {
      images: [
        {
          title: "Custom Search",
          imageUrl: "https://example.com/custom.jpg",
          thumbnailUrl: "https://example.com/custom-thumb.jpg",
          domain: "example.com",
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSerperResponse),
    });

    const { POST } = await import("./route");

    const request = {
      json: () =>
        Promise.resolve({
          directQuery: "custom search query",
        }),
    } as Request;

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.query).toBe("custom search query");
    expect(data.images).toHaveLength(1);
  });
});

describe("Gallery API with Serper Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch images from multiple sources in parallel", async () => {
    // Mock Serper response
    const mockSerperResponse = {
      images: [
        {
          title: "Serper Image",
          imageUrl: "https://serper.com/image1.jpg",
          thumbnailUrl: "https://serper.com/thumb1.jpg",
          domain: "serper.com",
        },
      ],
    };

    // Mock Jikan response
    const mockJikanSearchResponse = {
      data: [{ mal_id: 12345 }],
    };

    const mockJikanPicturesResponse = {
      data: [
        { jpg: { image_url: "https://jikan.com/official.jpg" } },
      ],
    };

    // Mock Konachan response
    const mockKonachanResponse = [
      {
        file_url: "https://konachan.net/fanart.jpg",
        preview_url: "https://konachan.net/fanart-thumb.jpg",
      },
    ];

    mockFetch
      // Serper
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockSerperResponse),
      })
      // Jikan search
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJikanSearchResponse),
      })
      // Jikan pictures
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockJikanPicturesResponse),
      })
      // Konachan
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockKonachanResponse),
      });

    const { POST } = await import("../gallery/route");

    const request = {
      json: () =>
        Promise.resolve({
          characterName: "Rem",
          animeSource: "Re:Zero",
        }),
    } as Request;

    const response = await POST(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Should have images from all sources
    expect(data.images.length).toBeGreaterThan(0);
  });

  it("should deduplicate images with same URL or different params", async () => {
    const baseUrl = "https://example.com/same-image.jpg";
    const duplicateUrl1 = `${baseUrl}?width=200`;
    const duplicateUrl2 = `${baseUrl}?source=web`;

    const mockSerperResponse = {
      images: [
        {
          title: "Image 1 (Base)",
          imageUrl: baseUrl,
          thumbnailUrl: baseUrl,
          domain: "example.com",
        },
        {
          title: "Image 2 (Params 1)",
          imageUrl: duplicateUrl1,
          thumbnailUrl: duplicateUrl1,
          domain: "example.com",
        },
        {
          title: "Image 3 (Params 2)",
          imageUrl: duplicateUrl2,
          thumbnailUrl: duplicateUrl2,
          domain: "example.com",
        },
      ],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSerperResponse),
    });

    const { POST } = await import("../gallery/route");

    const request = {
      json: () =>
        Promise.resolve({
          characterName: "Rem",
        }),
    } as Request;

    const response = await POST(request as any);
    const data = await response.json();

    // Check that duplicates are removed
    expect(data.images.length).toBe(1);
    expect(data.images[0].url).toContain(baseUrl);
  });
});
