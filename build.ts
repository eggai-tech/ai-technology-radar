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

type Ring = "Adopt" | "Trial" | "Assess" | "Hold";
type Quadrant = "Techniques" | "Tools" | "Languages & Frameworks" | "Platforms";

const RINGS: Ring[] = ["Adopt", "Trial", "Assess", "Hold"];

const QUADRANT_FOLDER_MAP: Record<string, Quadrant> = {
  techniques: "Techniques",
  tools: "Tools",
  "languages-and-frameworks": "Languages & Frameworks",
  platforms: "Platforms",
};

// Zalando radar quadrant indices:
// 0 = bottom-right, 1 = bottom-left, 2 = top-left, 3 = top-right
const QUADRANT_INDEX: Record<Quadrant, number> = {
  Tools: 0,
  Platforms: 1,
  "Languages & Frameworks": 2,
  Techniques: 3,
};

const RING_INDEX: Record<Ring, number> = {
  Adopt: 0,
  Trial: 1,
  Assess: 2,
  Hold: 3,
};

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

// --- Load vendored radar.js ---

function loadRadarJs(): string {
  const radarJsPath = path.join(process.cwd(), "vendor", "radar.js");
  return fs.readFileSync(radarJsPath, "utf-8");
}

// --- Convert blips to Zalando entry format ---

function toZalandoEntries(blips: BlipYaml[]): object[] {
  return blips.map((b) => ({
    label: b.name,
    quadrant: QUADRANT_INDEX[b.quadrant as Quadrant],
    ring: RING_INDEX[b.ring],
    moved: 0,
    active: true,
    link: "",
    url: b.url || "",
    description: b.description || "",
    quadrantName: b.quadrant,
    ringName: b.ring,
  }));
}

// --- Generate HTML ---

function generateHTML(
  entries: object[],
  deprecated: DeprecatedEntry[],
  radarJs: string
): string {
  const entriesJSON = JSON.stringify(entries);
  const deprecatedJSON = JSON.stringify(
    deprecated.map((d) => ({
      name: d.name,
      description: d.description,
      url: d.url,
    }))
  );

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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@400;700&display=swap" rel="stylesheet">
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Source Sans Pro', Arial, Helvetica, sans-serif; background: #fff; color: #333; }
  .container { max-width: 1500px; margin: 0 auto; padding: 0; text-align: center; }
  svg#radar { width: 100%; max-width: 1450px; height: auto; }
  .deprecated-section { text-align: left; max-width: 900px; margin: 0 auto; padding: 20px; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .deprecated-section h3 { font-size: 15px; margin-bottom: 8px; color: #1a1a1a; border-bottom: 2px solid #999; padding-bottom: 4px; }
  .deprecated-section ul { list-style: none; }
  .deprecated-section li { padding: 3px 0; font-size: 13px; cursor: pointer; color: #666; }
  .tooltip {
    position: fixed; display: none; background: #1e293b; color: white;
    padding: 10px 14px; border-radius: 8px; font-size: 13px; max-width: 300px;
    pointer-events: none; z-index: 1000; line-height: 1.4; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  .tooltip .tt-name { font-weight: bold; font-size: 14px; margin-bottom: 4px; }
  .tooltip .tt-ring { font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
  .tooltip .tt-desc { font-size: 12px; opacity: 0.9; }
  a.hover-underline { text-decoration: none; }
  a.hover-underline:hover { text-decoration: underline; }
  .modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    z-index: 2000; justify-content: center; align-items: center;
  }
  .modal-overlay.visible { display: flex; }
  .modal {
    background: #1e293b; color: #f1f5f9; border-radius: 12px; padding: 28px 32px;
    max-width: 520px; width: 90%; max-height: 80vh; overflow-y: auto;
    position: relative; box-shadow: 0 8px 30px rgba(0,0,0,0.4);
    font-size: 14px; line-height: 1.6;
  }
  .modal-close {
    position: absolute; top: 12px; right: 16px; background: none; border: none;
    color: #94a3b8; font-size: 24px; cursor: pointer; line-height: 1;
  }
  .modal-close:hover { color: #fff; }
  .modal-title { font-size: 20px; margin-bottom: 8px; color: #fff; padding-right: 28px; }
  .modal-meta { display: flex; gap: 8px; margin-bottom: 16px; }
  .modal-meta span {
    display: inline-block; padding: 2px 10px; border-radius: 12px;
    font-size: 12px; font-weight: 600;
  }
  .modal-meta .badge-quadrant { background: #334155; color: #cbd5e1; }
  .modal-meta .badge-ring { color: #fff; }
  .modal-desc { margin-bottom: 16px; color: #cbd5e1; }
  .modal-desc a { color: #38bdf8; }
  .modal-desc a:hover { text-decoration: underline; }
  .modal-link {
    display: inline-block; color: #38bdf8; text-decoration: none; font-size: 13px;
  }
  .modal-link:hover { text-decoration: underline; }
  .modal-link:empty { display: none; }
</style>
</head>
<body>
<div class="container">
  <svg id="radar"></svg>
  ${deprecatedHTML}
</div>
<div class="tooltip" id="dep-tooltip">
  <div class="tt-name"></div>
  <div class="tt-ring"></div>
  <div class="tt-desc"></div>
</div>
<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <button class="modal-close" id="modal-close">&times;</button>
    <h2 class="modal-title" id="modal-title"></h2>
    <div class="modal-meta" id="modal-meta"></div>
    <div class="modal-desc" id="modal-desc"></div>
    <a class="modal-link" id="modal-link" target="_blank" rel="noopener"></a>
  </div>
</div>
<script>
${radarJs}
<\/script>
<script>
radar_visualization({
  svg_id: "radar",
  width: 1450,
  height: 1000,
  colors: {
    background: "#fff",
    grid: "#dddde0",
    inactive: "#ddd"
  },
  title: "AI Technology Radar",
  date: "${new Date().toISOString().slice(0, 10)}",
  quadrants: [
    { name: "Tools" },
    { name: "Platforms" },
    { name: "Languages & Frameworks" },
    { name: "Techniques" }
  ],
  rings: [
    { name: "Adopt", color: "#5ba300" },
    { name: "Trial", color: "#009eb0" },
    { name: "Assess", color: "#c7ba00" },
    { name: "Hold", color: "#e09b96" }
  ],
  print_layout: true,
  links_in_new_tabs: true,
  entries: ${entriesJSON}
});
<\/script>
<script>
(function() {
  var deprecated = ${deprecatedJSON};
  var tooltip = document.getElementById('dep-tooltip');
  var ttName = tooltip.querySelector('.tt-name');
  var ttRing = tooltip.querySelector('.tt-ring');
  var ttDesc = tooltip.querySelector('.tt-desc');

  function attachDeprecatedListeners(el, entry) {
    el.addEventListener('mouseenter', function(e) {
      ttName.textContent = entry.name;
      ttRing.textContent = 'Deprecated';
      ttDesc.textContent = entry.description;
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
      if (entry.url) window.open(entry.url, '_blank');
    });
  }

  document.querySelectorAll('.deprecated-item').forEach(function(el) {
    var name = el.getAttribute('data-name');
    var entry = deprecated.find(function(d) { return d.name === name; });
    if (!entry) return;
    attachDeprecatedListeners(el, entry);
  });
})();
<\/script>
<script>
(function() {
  var entries = ${entriesJSON};
  var ringColors = { Adopt: '#5ba300', Trial: '#009eb0', Assess: '#c7ba00', Hold: '#e09b96' };
  var lookup = {};
  entries.forEach(function(e) { lookup[e.label] = e; });

  function renderMd(text) {
    var s = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    s = s.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\\n\\n+/g, '<br>').replace(/\\n/g, ' ');
    return s;
  }

  var overlay = document.getElementById('modal-overlay');
  var modalTitle = document.getElementById('modal-title');
  var modalMeta = document.getElementById('modal-meta');
  var modalDesc = document.getElementById('modal-desc');
  var modalLink = document.getElementById('modal-link');
  var modalClose = document.getElementById('modal-close');

  function openModal(entry) {
    modalTitle.textContent = entry.label;
    var rc = ringColors[entry.ringName] || '#666';
    modalMeta.innerHTML =
      '<span class="badge-quadrant">' + entry.quadrantName + '</span>' +
      '<span class="badge-ring" style="background:' + rc + '">' + entry.ringName + '</span>';
    modalDesc.innerHTML = entry.description ? renderMd(entry.description) : '<em>No description available.</em>';
    var url = entry.url || entry.link || '';
    if (url) {
      modalLink.href = url;
      modalLink.textContent = url;
    } else {
      modalLink.href = '';
      modalLink.textContent = '';
    }
    overlay.classList.add('visible');
  }

  function closeModal() { overlay.classList.remove('visible'); }

  modalClose.addEventListener('click', closeModal);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

  // Intercept blip clicks (d3 binds entry data to each <g class="blip">)
  document.querySelectorAll('.blip').forEach(function(g) {
    var d = g.__data__;
    if (!d || !d.label) return;
    var entry = lookup[d.label];
    if (!entry) return;
    g.style.cursor = 'pointer';
    g.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openModal(entry);
    });
  });

  // Intercept legend item clicks (text elements with id="legendItemN")
  document.querySelectorAll('[id^="legendItem"]').forEach(function(text) {
    var d = text.__data__;
    if (!d || !d.label) return;
    var entry = lookup[d.label];
    if (!entry) return;
    var anchor = text.parentNode;
    if (anchor && anchor.tagName.toLowerCase() === 'a') {
      anchor.removeAttribute('href');
      anchor.style.cursor = 'pointer';
    }
    (anchor || text).addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openModal(entry);
    });
  });

  // Also handle deprecated item clicks to show modal
  var depEntries = ${deprecatedJSON};
  document.querySelectorAll('.deprecated-item').forEach(function(el) {
    var name = el.getAttribute('data-name');
    var dep = depEntries.find(function(d) { return d.name === name; });
    if (!dep) return;
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      openModal({
        label: dep.name,
        description: dep.description,
        link: dep.url || '',
        quadrantName: 'Deprecated',
        ringName: 'Hold'
      });
    });
  });
})();
<\/script>
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
  console.log(
    `Found ${rawBlips.length} technologies, ${deprecated.length} deprecated`
  );

  const radarJs = loadRadarJs();
  const entries = toZalandoEntries(rawBlips);
  const html = generateHTML(entries, deprecated, radarJs);

  const outPath = path.join(distDir, "index.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`Generated ${outPath}`);
}

main();
