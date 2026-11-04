// ==================================================
// Music API - Cloudflare Worker
// ==================================================

const PAGALNEW_ORIGIN = "https://pagalnew.com";
const PAGALNEW_HOSTNAME = "pagalnew.com";

// Album search results come 4 per page; common words run to dozens of
// pages, so cap how many one /api/albums request fetches.
const MAX_ALBUM_PAGES = 15;

// Edge-cache album lookups so repeated searches don't refetch every page.
const ALBUM_CACHE_SECONDS = 3600;

// ==================================================
// Headers
// ==================================================

const browserHeaders = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",

  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

  "Accept-Language": "en-US,en;q=0.9",

  "Cache-Control": "no-cache",

  Pragma: "no-cache",
};

// ==================================================
// CORS
// ==================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ==================================================
// Response helpers
// ==================================================

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...corsHeaders,
    },
  });
}

// ==================================================
// Worker entry point
// ==================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // ----------------------------------------------
    // CORS preflight
    // ----------------------------------------------

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      if (request.method === "GET") {
        if (pathname === "/") {
          return handleHealth();
        }

        if (pathname === "/api/search") {
          return await handleSearch(url);
        }

        if (pathname === "/api/albums") {
          return await handleAlbumSearch(url);
        }

        if (pathname === "/api/album") {
          return await handleAlbum(url);
        }

        if (pathname === "/api/song") {
          return await handleSong(url);
        }

        if (pathname === "/api/stream") {
          return await handleStream(request, url);
        }
      }
    } catch (error) {
      console.error("Unhandled error:", error && error.message);

      return jsonResponse(
        {
          message: "Internal server error",
          error: error && error.message,
        },
        500
      );
    }

    // ----------------------------------------------
    // 404
    // ----------------------------------------------

    return jsonResponse(
      {
        message: "API endpoint not found",
        path: pathname + url.search,
      },
      404
    );
  },
};

// ==================================================
// Health Check
// ==================================================

function handleHealth() {
  return jsonResponse({
    message: "Music API is running",
    status: "ok",
  });
}

// ==================================================
// SEARCH PAGALNEW
// ==================================================

async function handleSearch(url) {
  const findParam = url.searchParams.get("find");

  const find = typeof findParam === "string" ? findParam.trim() : "";

  // ----------------------------------------------
  // Validate search query
  // ----------------------------------------------

  if (!find) {
    return jsonResponse(
      {
        message: "Search query is required",
      },
      400
    );
  }

  // ----------------------------------------------
  // Build PagalNew search URL
  // ----------------------------------------------

  const searchUrl = `${PAGALNEW_ORIGIN}/search.php?find=${encodeURIComponent(
    find
  )}`;

  console.log("----------------------------------------");
  console.log("SEARCH REQUEST");
  console.log("----------------------------------------");

  console.log("Search query:", find);
  console.log("PagalNew URL:", searchUrl);

  try {
    // --------------------------------------------
    // Request PagalNew
    // --------------------------------------------

    console.log("Requesting PagalNew:", searchUrl);

    // fetch() does not throw on 403 etc., so we can
    // inspect the response status ourselves.
    const response = await fetch(searchUrl, {
      headers: browserHeaders,
      signal: AbortSignal.timeout(15000),
    });

    const body = await response.text();

    // --------------------------------------------
    // Debug response
    // --------------------------------------------

    console.log("PagalNew status:", response.status);

    console.log(
      "PagalNew content-type:",
      response.headers.get("content-type")
    );

    console.log("PagalNew server:", response.headers.get("server"));

    console.log("PagalNew CF-Ray:", response.headers.get("cf-ray"));

    // --------------------------------------------
    // Print first 500 characters
    // --------------------------------------------

    console.log("PagalNew body:");

    console.log(body ? body.slice(0, 500) : "EMPTY RESPONSE");

    console.log("----------------------------------------");

    // --------------------------------------------
    // Handle non-success response
    // --------------------------------------------

    if (response.status < 200 || response.status >= 300) {
      return jsonResponse(
        {
          message: "PagalNew search request failed",

          status: response.status,

          contentType: response.headers.get("content-type") || null,
        },
        502
      );
    }

    // --------------------------------------------
    // Return PagalNew HTML
    // --------------------------------------------

    return htmlResponse(body);
  } catch (error) {
    console.error("PagalNew search failed:");

    console.error({
      message: error.message,

      name: error.name,
    });

    return jsonResponse(
      {
        message: "Unable to search PagalNew",

        error: error.message,
      },
      502
    );
  }
}

// ==================================================
// SEARCH ALBUMS (every result page)
// ==================================================

// PagalNew shows only ~6 songs per search with no paging, but its album
// results are paginated. A song whose title is a common word ("Khat") is often
// only reachable through its album, so collect the albums from every page.

async function handleAlbumSearch(url) {
  const findParam = url.searchParams.get("find");

  const find = typeof findParam === "string" ? findParam.trim() : "";

  if (!find) {
    return jsonResponse(
      {
        message: "Search query is required",
      },
      400
    );
  }

  const pageUrl = (page) =>
    `${PAGALNEW_ORIGIN}/search.php?find=${encodeURIComponent(
      find
    )}&page_album=${page}`;

  console.log("----------------------------------------");
  console.log("ALBUM SEARCH REQUEST");
  console.log("----------------------------------------");

  console.log("Search query:", find);

  try {
    const first = await fetchCachedHtml(pageUrl(1));

    // --------------------------------------------
    // Find the last page from the pagination links
    // --------------------------------------------

    const pageNumbers = [...first.matchAll(/page_album=(\d+)/g)].map((m) =>
      Number(m[1])
    );

    const lastPage = Math.min(
      Math.max(1, ...pageNumbers),
      MAX_ALBUM_PAGES
    );

    console.log("Album pages:", lastPage);

    // --------------------------------------------
    // Fetch the remaining pages in parallel
    // --------------------------------------------

    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, i) =>
        fetchCachedHtml(pageUrl(i + 2)).catch(() => "")
      )
    );

    const seen = new Set();

    const albums = [first, ...rest]
      .flatMap(parseAlbumResults)
      .filter((album) => !seen.has(album.url) && seen.add(album.url));

    return jsonResponse({ albums });
  } catch (error) {
    console.error("PagalNew album search failed:", error.message);

    return jsonResponse(
      {
        message: "Unable to search PagalNew albums",

        error: error.message,
      },
      502
    );
  }
}

// ==================================================
// ALBUM PAGE (song list)
// ==================================================

async function handleAlbum(url) {
  const urlParam = url.searchParams.get("url");

  const albumUrl = typeof urlParam === "string" ? urlParam : "";

  // ----------------------------------------------
  // Validate URL
  // ----------------------------------------------

  let parsedUrl;

  try {
    parsedUrl = new URL(albumUrl);
  } catch {
    return jsonResponse(
      {
        message: "A valid album page URL is required",
      },
      400
    );
  }

  // ----------------------------------------------
  // Security validation
  // ----------------------------------------------

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== PAGALNEW_HOSTNAME ||
    !parsedUrl.pathname.startsWith("/album/")
  ) {
    return jsonResponse(
      {
        message: "Album URL must be a pagalnew.com album page",
      },
      400
    );
  }

  console.log("----------------------------------------");
  console.log("ALBUM REQUEST");
  console.log("----------------------------------------");

  console.log("Album page:", parsedUrl.href);

  try {
    const html = await fetchCachedHtml(parsedUrl.href);

    return jsonResponse(parseAlbumPage(html, parsedUrl.href));
  } catch (error) {
    console.error("PagalNew album lookup failed:", error.message);

    return jsonResponse(
      {
        message: "Unable to load this album",

        error: error.message,
      },
      502
    );
  }
}

// ==================================================
// SONG PAGE
// ==================================================

async function handleSong(url) {
  const urlParam = url.searchParams.get("url");

  const pageUrl = typeof urlParam === "string" ? urlParam : "";

  // ----------------------------------------------
  // Validate URL
  // ----------------------------------------------

  let parsedUrl;

  try {
    parsedUrl = new URL(pageUrl);
  } catch {
    return jsonResponse(
      {
        message: "A valid song page URL is required",
      },
      400
    );
  }

  // ----------------------------------------------
  // Security validation
  // ----------------------------------------------

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== PAGALNEW_HOSTNAME
  ) {
    return jsonResponse(
      {
        message: "Song URL must belong to pagalnew.com",
      },
      400
    );
  }

  console.log("----------------------------------------");
  console.log("SONG REQUEST");
  console.log("----------------------------------------");

  console.log("Song page:", pageUrl);

  try {
    const response = await fetch(pageUrl, {
      headers: {
        ...browserHeaders,

        Referer: PAGALNEW_ORIGIN + "/",
      },
      signal: AbortSignal.timeout(15000),
    });

    const body = await response.text();

    // --------------------------------------------
    // Debug response
    // --------------------------------------------

    console.log("PagalNew song status:", response.status);

    console.log(
      "PagalNew song content-type:",
      response.headers.get("content-type")
    );

    console.log("PagalNew song body:");

    console.log(body ? body.slice(0, 500) : "EMPTY RESPONSE");

    // --------------------------------------------
    // Handle failed response
    // --------------------------------------------

    if (response.status < 200 || response.status >= 300) {
      return jsonResponse(
        {
          message: "Unable to access PagalNew song page",

          status: response.status,
        },
        502
      );
    }

    // --------------------------------------------
    // Extract audio URL
    // --------------------------------------------

    const audioUrl = findAudioUrl(body, pageUrl);

    if (!audioUrl) {
      return jsonResponse(
        {
          message: "Unable to find audio URL",
        },
        404
      );
    }

    console.log("Found audio URL:", audioUrl);

    // --------------------------------------------
    // Create stream URL
    // --------------------------------------------

    const streamUrl = `/api/stream?url=${encodeURIComponent(audioUrl)}`;

    return jsonResponse({
      audioUrl: streamUrl,

      sourceUrl: audioUrl,
    });
  } catch (error) {
    console.error("PagalNew song lookup failed:", error.message);

    return jsonResponse(
      {
        message: "Unable to find audio URL",

        error: error.message,
      },
      502
    );
  }
}

// ==================================================
// AUDIO STREAM
// ==================================================

async function handleStream(request, url) {
  const urlParam = url.searchParams.get("url");

  const sourceUrl = typeof urlParam === "string" ? urlParam : "";

  // ----------------------------------------------
  // Validate URL
  // ----------------------------------------------

  let parsedUrl;

  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    return jsonResponse(
      {
        message: "A valid audio URL is required",
      },
      400
    );
  }

  // ----------------------------------------------
  // Security validation
  // ----------------------------------------------

  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== PAGALNEW_HOSTNAME
  ) {
    return jsonResponse(
      {
        message: "Audio URL must belong to pagalnew.com",
      },
      400
    );
  }

  console.log("----------------------------------------");
  console.log("STREAM REQUEST");
  console.log("----------------------------------------");

  console.log("Audio URL:", parsedUrl.href);

  try {
    // Forward the client's Range header (if any) so seeking works
    // and upstream can answer with 206 + Content-Range.
    const upstreamHeaders = {
      ...browserHeaders,

      Referer: PAGALNEW_ORIGIN + "/",
    };

    const range = request.headers.get("Range");

    if (range) {
      upstreamHeaders["Range"] = range;
    }

    // The timeout only covers waiting for the upstream response
    // headers; once we return the Response, the body streams freely.
    const controller = new AbortController();

    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response;

    try {
      response = await fetch(parsedUrl.href, {
        headers: upstreamHeaders,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    console.log("PagalNew audio status:", response.status);

    // --------------------------------------------
    // Handle failed response
    // (206 Partial Content is a success for ranges)
    // --------------------------------------------

    if (response.status < 200 || response.status >= 300) {
      // Release the upstream connection
      if (response.body) {
        await response.body.cancel();
      }

      return jsonResponse(
        {
          message: "Unable to retrieve audio",

          status: response.status,
        },
        502
      );
    }

    // --------------------------------------------
    // Forward headers
    // --------------------------------------------

    const headers = new Headers(corsHeaders);

    const forwardHeaders = [
      "Content-Type",
      "Content-Length",
      "Accept-Ranges",
      "Content-Range",
    ];

    for (const name of forwardHeaders) {
      const value = response.headers.get(name);

      if (value) {
        headers.set(name, value);
      }
    }

    // --------------------------------------------
    // Stream audio to client
    // --------------------------------------------

    return new Response(response.body, {
      status: response.status,

      headers,
    });
  } catch (error) {
    console.error("PagalNew audio stream failed:", error.message);

    return jsonResponse(
      {
        message: "Unable to stream this song",

        error: error.message,
      },
      502
    );
  }
}

// ==================================================
// FIND AUDIO URL
// ==================================================

function findAudioUrl(html, pageUrl) {
  if (!html || typeof html !== "string") {
    return null;
  }

  // ----------------------------------------------
  // Look for <audio src="...">
  // ----------------------------------------------

  const audioMatch = html.match(
    /<audio\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i
  );

  const audioSrc = audioMatch?.[1] || null;

  // ----------------------------------------------
  // Find download links
  // ----------------------------------------------

  const downloadLinks = [
    ...html.matchAll(
      /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    ),
  ];

  // ----------------------------------------------
  // Prefer 128 KBPS link
  // ----------------------------------------------

  const preferredLink = downloadLinks.find(([, href, text]) =>
    /128[- ]?kbps|128-downloads/i.test(`${href} ${text}`)
  );

  const candidate = preferredLink?.[1] || audioSrc;

  if (!candidate) {
    console.log("No audio URL found in PagalNew HTML");

    return null;
  }

  // ----------------------------------------------
  // Resolve relative URL
  // ----------------------------------------------

  try {
    const resolved = new URL(candidate, pageUrl);

    // ------------------------------------------
    // Security validation
    // ------------------------------------------

    if (
      resolved.protocol !== "https:" ||
      resolved.hostname !== PAGALNEW_HOSTNAME
    ) {
      return null;
    }

    return resolved.href;
  } catch {
    return null;
  }
}

// ==================================================
// ALBUM HELPERS
// ==================================================

async function fetchCachedHtml(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: {
      ...browserHeaders,

      Referer: PAGALNEW_ORIGIN + "/",
    },
    signal: AbortSignal.timeout(15000),
    cf: { cacheTtl: ALBUM_CACHE_SECONDS, cacheEverything: true },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`PagalNew responded ${response.status}`);
  }

  return response.text();
}

function textOf(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function squash(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Search page entry:
// <a href="/album/khat-2025.html"> ... <img src="../coverimages/album/...jpg">
// ... <b>Khat 2025 Mp3 Songs</b> ... </a>
function parseAlbumResults(html) {
  return [...html.matchAll(/<a href="(\/album\/[^"]+)">([\s\S]*?)<\/a>/g)]
    .map(([, href, inner]) => {
      const label = textOf(inner.match(/<b>([\s\S]*?)<\/b>/)?.[1] || "");

      const named = label
        .replace(/\s*Mp3 Songs?\s*$/i, "")
        .match(/^(.*?)(?:\s+((?:19|20)\d\d))?$/);

      const image = inner.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1];

      // Most labels omit the year, but the album slug ends with it.
      const year = named?.[2] || href.match(/-((?:19|20)\d\d)\.html$/)?.[1];

      return {
        url: new URL(href, PAGALNEW_ORIGIN).href,

        name: named?.[1]?.trim() || label,

        year: year ? Number(year) : null,

        imageUrl: image ? new URL(image, PAGALNEW_ORIGIN + "/").href : null,
      };
    })
    .filter((album) => album.name);
}

// Album page song entry:
// <a href="https://pagalnew.com/songs/khat-navjot-ahuja.html"> ...
// <div>Khat - Navjot Ahuja Mp3 Song</div> <div>Navjot Ahuja</div> ... </a>
function parseAlbumPage(html, albumUrl) {
  const name = textOf(
    html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/)?.[1] || ""
  ).replace(/\s*Mp3 Songs?\s*(-\s*\d{4})?\s*$/i, "");

  const cover = html.match(
    /data-src="([^"]*\/coverimages\/album\/[^"]+)"/
  )?.[1];

  const seen = new Set();

  const songs = [
    ...html.matchAll(/<a href="([^"]*\/songs\/[^"]+)">([\s\S]*?)<\/a>/g),
  ]
    .map(([, href, inner]) => {
      const lines = [...inner.matchAll(/<div\b[^>]*>([^<]*)<\/div>/g)]
        .map((m) => textOf(m[1]))
        .filter(Boolean);

      const rawArtist = lines[1] || "";

      let title = (lines[0] || "").replace(/\s*Mp3 Song\s*$/i, "");

      // Titles end with " - <artist>" on singles and " - <album>" on
      // soundtracks; search results show neither, so drop the suffix.
      const dash = title.lastIndexOf(" - ");

      if (dash > 0) {
        const suffix = squash(title.slice(dash + 3));

        if (suffix === squash(rawArtist) || suffix === squash(name)) {
          title = title.slice(0, dash);
        }
      }

      return {
        pageUrl: new URL(href, albumUrl).href,

        title: title.trim(),

        // Album pages separate artists with " - "; search uses ", ".
        artist: rawArtist.split(" - ").join(", "),
      };
    })
    .filter(
      (song) =>
        song.title && !seen.has(song.pageUrl) && seen.add(song.pageUrl)
    );

  return {
    name,

    imageUrl: cover ? new URL(cover, albumUrl).href : null,

    songs,
  };
}
