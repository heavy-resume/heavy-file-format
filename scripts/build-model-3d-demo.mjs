// Generates examples/model-3d-demo.hvy, including its binary tail attachments.
//
// The geometry is produced here rather than checked in as opaque binaries so
// the demo models stay obviously synthetic and reviewable. Run with:
//   node_modules/.bin/vite-node scripts/build-model-3d-demo.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { deserializeDocument, serializeDocumentBytes } from '../src/serialization.ts';

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function faceNormal(triangle) {
  return normalize(cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0])));
}

/** Unit icosahedron, scaled. Small enough to read, interesting enough to shade. */
function createIcosahedron(radius) {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const vertices = raw.map(([x, y, z]) => {
    const unit = normalize({ x, y, z });
    return { x: unit.x * radius, y: unit.y * radius, z: unit.z * radius };
  });
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { vertices, faces, triangles: faces.map((face) => face.map((index) => vertices[index])) };
}

/** Torus knot sampled into a triangulated tube. */
function createTorusKnot(segments, sides, radius, tubeRadius) {
  const pointAt = (u) => {
    const p = 2;
    const q = 3;
    const r = radius * (2 + Math.cos((q * u) / p)) / 3;
    return {
      x: r * Math.cos(u),
      y: r * Math.sin(u),
      z: (radius * Math.sin((q * u) / p)) / 3,
    };
  };
  const ring = (u) => {
    const center = pointAt(u);
    const tangent = normalize(subtract(pointAt(u + 0.01), center));
    const normal = normalize(cross(tangent, { x: 0, y: 0, z: 1 }));
    const binormal = normalize(cross(tangent, normal));
    return Array.from({ length: sides }, (_, s) => {
      const angle = (s / sides) * Math.PI * 2;
      return {
        x: center.x + tubeRadius * (Math.cos(angle) * normal.x + Math.sin(angle) * binormal.x),
        y: center.y + tubeRadius * (Math.cos(angle) * normal.y + Math.sin(angle) * binormal.y),
        z: center.z + tubeRadius * (Math.cos(angle) * normal.z + Math.sin(angle) * binormal.z),
      };
    });
  };

  const rings = Array.from({ length: segments }, (_, i) => ring((i / segments) * Math.PI * 4));
  const vertices = rings.flat();
  const faces = [];
  for (let i = 0; i < segments; i += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = i * sides + s;
      const b = i * sides + ((s + 1) % sides);
      const c = ((i + 1) % segments) * sides + ((s + 1) % sides);
      const d = ((i + 1) % segments) * sides + s;
      faces.push([a, b, c], [a, c, d]);
    }
  }
  return { vertices, faces, triangles: faces.map((face) => face.map((index) => vertices[index])) };
}

/** Binary STL: 80-byte header, uint32 facet count, then 50 bytes per facet. */
function encodeBinaryStl(triangles, header) {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(header).slice(0, 79), 0);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (const triangle of triangles) {
    const normal = faceNormal(triangle);
    for (const component of [normal.x, normal.y, normal.z]) {
      view.setFloat32(offset, component, true);
      offset += 4;
    }
    for (const vertex of triangle) {
      for (const component of [vertex.x, vertex.y, vertex.z]) {
        view.setFloat32(offset, component, true);
        offset += 4;
      }
    }
    offset += 2;
  }
  return bytes;
}

function encodeObj(mesh, name) {
  const lines = [`# ${name}`, `o ${name}`];
  for (const vertex of mesh.vertices) {
    lines.push(`v ${vertex.x.toFixed(6)} ${vertex.y.toFixed(6)} ${vertex.z.toFixed(6)}`);
  }
  for (const face of mesh.faces) {
    lines.push(`f ${face.map((index) => index + 1).join(' ')}`);
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

/** ASCII PLY carrying per-vertex color, so the demo exercises vertex colors. */
function encodePly(mesh, colorAt) {
  const lines = [
    'ply',
    'format ascii 1.0',
    `element vertex ${mesh.vertices.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${mesh.faces.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ];
  mesh.vertices.forEach((vertex, index) => {
    const [r, g, b] = colorAt(vertex, index);
    lines.push(`${vertex.x.toFixed(6)} ${vertex.y.toFixed(6)} ${vertex.z.toFixed(6)} ${r} ${g} ${b}`);
  });
  for (const face of mesh.faces) {
    lines.push(`${face.length} ${face.join(' ')}`);
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

const body = `---
hvy_version: 1.0
title: 3D Model plugin demo
plugins:
  - id: hvy.model-3d
---

#! 3D Model plugin demo

Every model below is stored as a binary tail attachment inside this single
\`.hvy\` file, so the document renders offline with no external requests. Drag to
orbit, scroll to zoom, and use Reset view to reframe a model.

The shapes are generated by \`scripts/build-model-3d-demo.mjs\`; they are not
scans or captures of anything real.

<!--hvy:text {"id":"demo-stl-caption"}-->
### Binary STL

Triangle soup with per-facet normals. The most common 3D-printing interchange
format.

<!--hvy:plugin {"id":"demo-stl","plugin":"hvy.model-3d","pluginConfig":{"modelFile":"placeholder-knot.stl","mediaType":"model/stl","title":"Placeholder torus knot","height":380,"showGrid":true,"autoRotate":true,"wireframe":false,"allowDownload":true}}-->
3D model. Geometry is stored in the HVY tail attachment.

<!--hvy:text {"id":"demo-obj-caption"}-->
### Wavefront OBJ

Text geometry with no companion material file, so it renders with the viewer's
default surface. Shown as wireframe to make the triangulation visible.

<!--hvy:plugin {"id":"demo-obj","plugin":"hvy.model-3d","pluginConfig":{"modelFile":"placeholder-icosahedron.obj","mediaType":"model/obj","title":"Placeholder icosahedron","height":320,"showGrid":false,"autoRotate":false,"wireframe":true,"allowDownload":true}}-->
3D model. Geometry is stored in the HVY tail attachment.

<!--hvy:text {"id":"demo-ply-caption"}-->
### PLY with vertex colors

Per-vertex color travels with the geometry, so no texture files are referenced
and nothing needs to be fetched.

<!--hvy:plugin {"id":"demo-ply","plugin":"hvy.model-3d","pluginConfig":{"modelFile":"placeholder-knot.ply","mediaType":"application/x-ply","title":"Placeholder colored knot","height":380,"showGrid":true,"autoRotate":false,"wireframe":false,"allowDownload":false}}-->
3D model. Geometry is stored in the HVY tail attachment.
`;

const knot = createTorusKnot(64, 8, 3, 0.55);
const icosahedron = createIcosahedron(1.4);

const document = deserializeDocument(body, '.hvy');
document.attachments = [
  {
    id: 'model-3d:placeholder-knot.stl',
    meta: { mediaType: 'model/stl', plugin: 'hvy.model-3d' },
    bytes: encodeBinaryStl(knot.triangles, 'HVY placeholder torus knot'),
  },
  {
    id: 'model-3d:placeholder-icosahedron.obj',
    meta: { mediaType: 'model/obj', plugin: 'hvy.model-3d' },
    bytes: encodeObj(icosahedron, 'placeholder-icosahedron'),
  },
  {
    id: 'model-3d:placeholder-knot.ply',
    meta: { mediaType: 'application/x-ply', plugin: 'hvy.model-3d' },
    bytes: encodePly(knot, (vertex) => {
      const angle = Math.atan2(vertex.y, vertex.x) / Math.PI;
      return [
        Math.round(128 + 127 * Math.sin(angle * Math.PI)),
        Math.round(128 + 127 * Math.cos(angle * Math.PI)),
        Math.round(160 + 80 * Math.sin(vertex.z)),
      ];
    }),
  },
];

const target = resolve(process.cwd(), 'examples/model-3d-demo.hvy');
const bytes = serializeDocumentBytes(document);
writeFileSync(target, bytes);
console.log(`Wrote ${target} (${bytes.length} bytes)`);
for (const attachment of document.attachments) {
  console.log(`  ${attachment.id}: ${attachment.bytes.length} bytes`);
}
