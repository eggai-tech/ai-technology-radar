import fs from "fs";
import path from "path";
import yaml from "js-yaml";

// --- Types ---

interface BlipYaml {
  name: string;
  quadrant: string;
  ring: Ring;
  description: string;
  url: string;
}

interface DeprecatedEntry {
  name: string;
  description: string;
  url: string;
}

interface Blip extends BlipYaml {
  index: number;
  x: number;
  y: number;
}

type Ring = "Adopt" | "Trial" | "Assess" | "Hold";
type Quadrant = "Techniques" | "Tools" | "Languages & Frameworks" | "Platforms";

const RINGS: Ring[] = ["Adopt", "Trial", "Assess", "Hold"];
const QUADRANTS: Quadrant[] = [
  "Techniques",
  "Tools",
  "Languages & Frameworks",
  "Platforms",
];

const QUADRANT_FOLDER_MAP: Record<string, Quadrant> = {
  techniques: "Techniques",
  tools: "Tools",
  "languages-and-frameworks": "Languages & Frameworks",
  platforms: "Platforms",
};

// --- Deterministic hash ---

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// --- Read & parse YAML files ---

function loadBlips(radarDir: string): BlipYaml[] {
  const blips: BlipYaml[] = [];

  for (const folder of Object.keys(QUADRANT_FOLDER_MAP)) {
    const dirPath = path.join(radarDir, folder);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
      const data = yaml.load(content) as BlipYaml;

      if (!data.name || !data.ring || !data.description) {
        console.warn(`Skipping invalid YAML: ${file}`);
        continue;
      }

      if (!RINGS.includes(data.ring)) {
        console.warn(
          `Invalid ring "${data.ring}" in ${file}. Must be one of: ${RINGS.join(", ")}`
        );
        continue;
      }

      // Use folder to determine quadrant
      data.quadrant = QUADRANT_FOLDER_MAP[folder];
      blips.push(data);
    }
  }

  return blips;
}

function loadDeprecated(radarDir: string): DeprecatedEntry[] {
  const entries: DeprecatedEntry[] = [];
  const dirPath = path.join(radarDir, "deprecated");
  if (!fs.existsSync(dirPath)) return entries;

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
    const data = yaml.load(content) as DeprecatedEntry;

    if (!data.name || !data.description) {
      console.warn(`Skipping invalid deprecated YAML: ${file}`);
      continue;
    }

    entries.push(data);
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

// --- Position blips ---

function positionBlips(blips: BlipYaml[]): Blip[] {
  const radarSize = 800;
  const center = radarSize / 2;
  const maxRadius = center - 40; // leave margin for labels

  const ringWidths = [0, 0.25, 0.5, 0.72, 1.0]; // boundaries as fraction of maxRadius

  // Quadrant angles: each quadrant gets 90°
  // Top-right: -90 to 0, Bottom-right: 0 to 90, Bottom-left: 90 to 180, Top-left: 180 to 270
  const quadrantAngles: Record<Quadrant, [number, number]> = {
    Techniques: [(-90 * Math.PI) / 180, (0 * Math.PI) / 180],
    Tools: [(0 * Math.PI) / 180, (90 * Math.PI) / 180],
    Platforms: [(90 * Math.PI) / 180, (180 * Math.PI) / 180],
    "Languages & Frameworks": [(180 * Math.PI) / 180, (270 * Math.PI) / 180],
  };

  const positioned: Blip[] = [];
  let index = 1;

  // Group blips by quadrant+ring for spacing
  const sectors = new Map<string, BlipYaml[]>();
  for (const blip of blips) {
    const key = `${blip.quadrant}:${blip.ring}`;
    if (!sectors.has(key)) sectors.set(key, []);
    sectors.get(key)!.push(blip);
  }

  // Sort blips by name for consistent ordering
  const sortedBlips = [...blips].sort((a, b) => a.name.localeCompare(b.name));

  for (const blip of sortedBlips) {
    const quadrant = blip.quadrant as Quadrant;
    const ringIndex = RINGS.indexOf(blip.ring);

    const [angleStart, angleEnd] = quadrantAngles[quadrant];
    const rInner = ringWidths[ringIndex] * maxRadius;
    const rOuter = ringWidths[ringIndex + 1] * maxRadius;

    // Use hash for deterministic placement
    const h = hashString(blip.name);
    const anglePad = 0.1; // padding from quadrant edges in radians
    const radiusPad = 12; // padding from ring edges in pixels

    const angleRange = angleEnd - angleStart - 2 * anglePad;
    const angle = angleStart + anglePad + (((h % 1000) / 1000) * angleRange);
    const radiusRange = rOuter - rInner - 2 * radiusPad;
    const radius =
      rInner + radiusPad + (((h % 997) / 997) * radiusRange);

    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);

    positioned.push({ ...blip, index, x, y });
    index++;
  }

  return positioned;
}

// --- Generate HTML ---

function generateHTML(blips: Blip[], deprecated: DeprecatedEntry[]): string {
  const radarSize = 800;
  const center = radarSize / 2;
  const maxRadius = center - 40;
  const ringBoundaries = [0, 0.25, 0.5, 0.72, 1.0];
  const ringColors = ["#d4edda", "#fff3cd", "#fce4c1", "#f8d7da"];

  // Group blips by quadrant for legend
  const byQuadrant = new Map<string, Blip[]>();
  for (const q of QUADRANTS) byQuadrant.set(q, []);
  for (const b of blips) byQuadrant.get(b.quadrant)!.push(b);

  const blipsJSON = JSON.stringify(
    blips.map((b) => ({
      index: b.index,
      name: b.name,
      description: b.description,
      url: b.url,
      quadrant: b.quadrant,
      ring: b.ring,
      x: b.x,
      y: b.y,
    }))
  );

  const deprecatedJSON = JSON.stringify(
    deprecated.map((d) => ({
      name: d.name,
      description: d.description,
      url: d.url,
    }))
  );

  // Build ring arcs SVG
  let ringSVG = "";
  for (let i = RINGS.length - 1; i >= 0; i--) {
    const r = ringBoundaries[i + 1] * maxRadius;
    ringSVG += `<circle cx="${center}" cy="${center}" r="${r}" fill="${ringColors[i]}" stroke="#ccc" stroke-width="1"/>`;
  }

  // Ring labels
  let ringLabelsSVG = "";
  for (let i = 0; i < RINGS.length; i++) {
    const rMid =
      ((ringBoundaries[i] + ringBoundaries[i + 1]) / 2) * maxRadius;
    ringLabelsSVG += `<text x="${center + rMid}" y="${center - 4}" text-anchor="middle" font-size="11" fill="#666" font-weight="bold">${RINGS[i]}</text>`;
  }

  // Cross-hair lines
  const crosshairSVG = `
    <line x1="${center}" y1="${center - maxRadius}" x2="${center}" y2="${center + maxRadius}" stroke="#bbb" stroke-width="1"/>
    <line x1="${center - maxRadius}" y1="${center}" x2="${center + maxRadius}" y2="${center}" stroke="#bbb" stroke-width="1"/>
  `;

  // Quadrant labels (positioned in respective corners)
  const qlPad = 14;
  const quadrantLabelsSVG = `
    <text x="${center + maxRadius}" y="${center - maxRadius - qlPad}" text-anchor="end" font-size="14" font-weight="bold" fill="#333">Techniques</text>
    <text x="${center + maxRadius}" y="${center + maxRadius + qlPad + 14}" text-anchor="end" font-size="14" font-weight="bold" fill="#333">Tools</text>
    <text x="${center - maxRadius}" y="${center + maxRadius + qlPad + 14}" text-anchor="start" font-size="14" font-weight="bold" fill="#333">Languages &amp; Frameworks</text>
    <text x="${center - maxRadius}" y="${center - maxRadius - qlPad}" text-anchor="start" font-size="14" font-weight="bold" fill="#333">Platforms</text>
  `;

  // Blip dots
  let blipsSVG = "";
  for (const b of blips) {
    blipsSVG += `
      <g class="blip" data-index="${b.index}" style="cursor:pointer">
        <circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="12" fill="#3b82f6" stroke="#1e40af" stroke-width="1.5" opacity="0.9"/>
        <text x="${b.x.toFixed(1)}" y="${(b.y + 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="white" font-weight="bold" pointer-events="none">${b.index}</text>
      </g>`;
  }

  // Legend HTML
  let legendHTML = "";
  for (const q of QUADRANTS) {
    const items = byQuadrant.get(q)!;
    if (items.length === 0) continue;
    legendHTML += `<div class="legend-quadrant"><h3>${escapeHTML(q)}</h3><ul>`;
    // Sort by ring order, then name
    items.sort(
      (a, b) =>
        RINGS.indexOf(a.ring) - RINGS.indexOf(b.ring) ||
        a.name.localeCompare(b.name)
    );
    for (const item of items) {
      legendHTML += `<li data-index="${item.index}"><span class="legend-index">${item.index}</span> <strong>${escapeHTML(item.name)}</strong> <span class="legend-ring ring-${item.ring.toLowerCase()}">${escapeHTML(item.ring)}</span></li>`;
    }
    legendHTML += `</ul></div>`;
  }

  // Deprecated section HTML
  let deprecatedHTML = "";
  if (deprecated.length > 0) {
    deprecatedHTML += `<div class="deprecated-section"><h3>Deprecated</h3><ul>`;
    for (const item of deprecated) {
      deprecatedHTML += `<li class="deprecated-item" data-name="${escapeHTML(item.name)}"><strong>${escapeHTML(item.name)}</strong></li>`;
    }
    deprecatedHTML += `</ul></div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AI Technology Radar</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fafafa; color: #333; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; text-align: center; }
  h1 { margin-bottom: 8px; font-size: 28px; color: #1a1a1a; }
  .subtitle { color: #666; margin-bottom: 24px; font-size: 14px; }
  .radar-wrapper { display: inline-block; width: 100%; max-width: ${radarSize}px; }
  svg { width: 100%; height: auto; }
  .tooltip {
    position: fixed; display: none; background: #1e293b; color: white;
    padding: 10px 14px; border-radius: 8px; font-size: 13px; max-width: 300px;
    pointer-events: none; z-index: 1000; line-height: 1.4; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  .tooltip .tt-name { font-weight: bold; font-size: 14px; margin-bottom: 4px; }
  .tooltip .tt-ring { font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
  .tooltip .tt-desc { font-size: 12px; opacity: 0.9; }
  .legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; text-align: left; margin-top: 32px; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .legend-quadrant h3 { font-size: 15px; margin-bottom: 8px; color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; }
  .legend-quadrant ul { list-style: none; }
  .legend-quadrant li { padding: 3px 0; font-size: 13px; cursor: pointer; }
  .legend-index { display: inline-block; width: 22px; height: 22px; line-height: 22px; text-align: center; background: #3b82f6; color: white; border-radius: 50%; font-size: 10px; font-weight: bold; margin-right: 4px; }
  .legend-ring { font-size: 11px; padding: 1px 6px; border-radius: 8px; margin-left: 4px; }
  .ring-adopt { background: #d4edda; color: #155724; }
  .ring-trial { background: #fff3cd; color: #856404; }
  .ring-assess { background: #fce4c1; color: #7c4a03; }
  .ring-hold { background: #f8d7da; color: #721c24; }
  .deprecated-section { text-align: left; margin-top: 24px; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .deprecated-section h3 { font-size: 15px; margin-bottom: 8px; color: #1a1a1a; border-bottom: 2px solid #999; padding-bottom: 4px; }
  .deprecated-section ul { list-style: none; }
  .deprecated-section li { padding: 3px 0; font-size: 13px; cursor: pointer; color: #666; }
  .blip circle { transition: r 0.15s, opacity 0.15s; }
  .blip:hover circle { r: 15; opacity: 1; }
</style>
</head>
<body>
<div class="container">
  <h1>AI Technology Radar</h1>
  <p class="subtitle">An overview of AI technologies, tools, and techniques we're tracking</p>
  <div class="radar-wrapper">
    <svg viewBox="0 0 ${radarSize} ${radarSize}" xmlns="http://www.w3.org/2000/svg">
      ${ringSVG}
      ${crosshairSVG}
      ${ringLabelsSVG}
      ${quadrantLabelsSVG}
      ${blipsSVG}
    </svg>
  </div>
  <div class="legend">${legendHTML}</div>
  ${deprecatedHTML}
</div>
<div class="tooltip" id="tooltip">
  <div class="tt-name"></div>
  <div class="tt-ring"></div>
  <div class="tt-desc"></div>
</div>
<script>
(function() {
  var blips = ${blipsJSON};
  var deprecated = ${deprecatedJSON};
  var tooltip = document.getElementById('tooltip');
  var ttName = tooltip.querySelector('.tt-name');
  var ttRing = tooltip.querySelector('.tt-ring');
  var ttDesc = tooltip.querySelector('.tt-desc');

  function attachBlipListeners(el, blip) {
    el.addEventListener('mouseenter', function(e) {
      ttName.textContent = blip.name;
      ttRing.textContent = blip.ring ? blip.quadrant + ' / ' + blip.ring : blip.quadrant;
      ttDesc.textContent = blip.description;
      tooltip.style.display = 'block';
    });

    el.addEventListener('mousemove', function(e) {
      var tx = e.clientX + 16;
      var ty = e.clientY + 16;
      if (tx + 300 > window.innerWidth) tx = e.clientX - 316;
      if (ty + 100 > window.innerHeight) ty = e.clientY - 100;
      tooltip.style.left = tx + 'px';
      tooltip.style.top = ty + 'px';
    });

    el.addEventListener('mouseleave', function() {
      tooltip.style.display = 'none';
    });

    el.addEventListener('click', function() {
      if (blip.url) window.open(blip.url, '_blank');
    });
  }

  document.querySelectorAll('.blip').forEach(function(el) {
    var idx = parseInt(el.getAttribute('data-index'));
    var blip = blips.find(function(b) { return b.index === idx; });
    if (!blip) return;
    attachBlipListeners(el, blip);
  });

  document.querySelectorAll('.legend-quadrant li[data-index]').forEach(function(el) {
    var idx = parseInt(el.getAttribute('data-index'));
    var blip = blips.find(function(b) { return b.index === idx; });
    if (!blip) return;
    attachBlipListeners(el, blip);
  });

  document.querySelectorAll('.deprecated-item').forEach(function(el) {
    var name = el.getAttribute('data-name');
    var entry = deprecated.find(function(d) { return d.name === name; });
    if (!entry) return;
    attachBlipListeners(el, { name: entry.name, quadrant: 'Deprecated', ring: '', description: entry.description, url: entry.url });
  });
})();
</script>
</body>
</html>`;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Main ---

function main() {
  const radarDir = path.join(process.cwd(), "radar");
  const distDir = path.join(process.cwd(), "dist");

  if (!fs.existsSync(radarDir)) {
    console.error("Error: radar/ directory not found");
    process.exit(1);
  }

  fs.mkdirSync(distDir, { recursive: true });

  const rawBlips = loadBlips(radarDir);
  const deprecated = loadDeprecated(radarDir);
  console.log(`Found ${rawBlips.length} technologies, ${deprecated.length} deprecated`);

  const blips = positionBlips(rawBlips);
  const html = generateHTML(blips, deprecated);

  const outPath = path.join(distDir, "index.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`Generated ${outPath}`);
}

main();
