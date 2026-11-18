const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const SOURCE_URL = "https://www.pvoil.com.vn/tin-gia-xang-dau";

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function parsePvoil(html) {
  const text = cleanText(html);
  const dateMatch = text.match(
    /Giá\s+điều\s+chỉnh\s+lúc\s*(\d{1,2}:\d{2})\s*ngày\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i
  );

  if (!dateMatch) {
    throw new Error("Không tìm thấy ngày điều chỉnh giá trong trang PVOIL.");
  }

  const updateTime = dateMatch[1];
  const day = dateMatch[2].padStart(2, "0");
  const month = dateMatch[3].padStart(2, "0");
  const year = dateMatch[4];
  const priceDate = `${year}-${month}-${day}`;

  const products = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cleanText(cellMatch[1]));
    }

    if (cells.length < 3) continue;

    const name = cells.find((cell) => /^(Xăng|Dầu)\b/i.test(cell));
    if (!name) continue;

    const priceCell = cells.find((cell) => /(?:đ|đồng)\s*$/i.test(cell) && /\d/.test(cell));
    if (!priceCell) continue;

    const priceMatch = priceCell.match(/(\d[\d.]*)/);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1].replace(/\./g, ""));

    // In the PVOIL table, the adjustment is the final numeric cell after the price.
    const nameIndex = cells.indexOf(name);
    const priceIndex = cells.indexOf(priceCell);
    const trailingCells = cells.slice(Math.max(nameIndex, priceIndex) + 1);
    let change = null;

    for (const cell of trailingCells) {
      if (/^[-+]?\s*\d[\d.,]*$/.test(cell)) {
        change = toNumber(cell);
      }
    }

    products.push({ name, price, change });
  }

  const uniqueProducts = [...new Map(products.map((item) => [item.name, item])).values()];

  if (uniqueProducts.length === 0) {
    throw new Error("Đã tải trang PVOIL nhưng không phân tích được bảng giá.");
  }

  return {
    status: "ok",
    source: "PVOIL",
    sourceUrl: SOURCE_URL,
    priceDate,
    updateTime,
    fetchedAt: new Date().toISOString(),
    count: uniqueProducts.length,
    products: uniqueProducts
  };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "pvoil-price-checker" });
});

app.get("/prices", async (_req, res) => {
  try {
    const response = await fetch(SOURCE_URL, {
      headers: {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://www.pvoil.com.vn/",
  "Origin": "https://www.pvoil.com.vn"
},
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      throw new Error(`PVOIL trả về HTTP ${response.status}`);
    }

    const html = await response.text();
    res.json(parsePvoil(html));
  } catch (error) {
    res.status(502).json({
      status: "error",
      source: "PVOIL",
      message: error.message,
      fetchedAt: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`PVOIL price checker listening on port ${PORT}`);
});
