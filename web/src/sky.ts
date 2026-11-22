/**
 * The sky. Starts black. A view the visitor holds appears as a faint point;
 * a view seen through becomes a light, joined to the lights it grew from.
 * At the end the lights gather into a circle and go out.
 */

export type Star = { id: string; name: string; after: string[]; pos: [number, number]; optional: boolean };

type Live = Star & { level: number; target: number; born: number; label: number };

type Edge = { from: string; to: string; t0: number };

const now = () => performance.now() / 1000;

export class Sky {
  private ctx: CanvasRenderingContext2D;
  private stars = new Map<string, Live>();
  private edges: Edge[] = [];
  private dust: { x: number; y: number; r: number; p: number }[] = [];
  private silenceAt = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private last = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    addEventListener("resize", () => this.resize());
    this.resize();
    for (let i = 0; i < 140; i++)
      this.dust.push({ x: Math.random(), y: Math.random() * 0.75, r: Math.random() * 0.8 + 0.2, p: Math.random() * 7 });
    requestAnimationFrame(this.frame);
  }

  setStars(list: Star[]) {
    this.stars.clear();
    this.edges = [];
    this.silenceAt = 0;
    for (const s of list) this.stars.set(s.id, { ...s, level: 0, target: 0, born: 0, label: 0 });
  }

  glimmer(id: string, instant = false) {
    const s = this.stars.get(id);
    if (!s || s.target >= 0.22) return;
    s.target = 0.22;
    if (instant) s.level = s.target;
  }

  dissolve(id: string, instant = false) {
    const s = this.stars.get(id);
    if (!s || s.target === 1) return;
    s.target = 1;
    s.born = instant ? now() - 60 : now();
    if (instant) s.level = 1;
    for (const a of s.after) {
      const p = this.stars.get(a);
      if (p && p.target === 1) this.edges.push({ from: a, to: id, t0: instant ? 0 : now() + 0.8 });
    }
    // Later lights may connect back to this one too (if walked out of order).
    for (const o of this.stars.values())
      if (o.target === 1 && o.after.includes(id) && !this.edges.some((e) => e.from === id && e.to === o.id))
        this.edges.push({ from: id, to: o.id, t0: instant ? 0 : now() + 0.8 });
  }

  silence(instant = false) {
    this.silenceAt = instant ? now() - 120 : now();
  }

  /** 0..1: how much of the sky is lit. Used for the faint dawn. */
  private progress() {
    const all = [...this.stars.values()];
    return all.length ? all.filter((s) => s.target === 1).length / all.length : 0;
  }

  private resize() {
    this.dpr = devicePixelRatio || 1;
    this.w = innerWidth;
    this.h = innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
  }

  private place([x, y]: [number, number]): [number, number] {
    const span = Math.min(this.w * 0.42, this.h * 0.5);
    return [this.w / 2 + x * span, this.h * (0.42 - y * 0.34)];
  }

  private frame = () => {
    const { ctx, w, h, dpr } = this;
    const t = now();
    const dt = Math.min(1, t - (this.last || t));
    this.last = t;
    const prog = this.progress();
    const sil = this.silenceAt ? Math.min(1, (t - this.silenceAt) / 14) : 0; // gather
    const fade = this.silenceAt ? Math.min(1, Math.max(0, (t - this.silenceAt - 12) / 14)) : 0; // go out

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background: black, warming imperceptibly as the sky fills.
    const warm = prog * 7 * (1 - fade);
    ctx.fillStyle = `rgb(${5 + warm}, ${5 + warm * 0.8}, ${6 + warm * 0.5})`;
    ctx.fillRect(0, 0, w, h);

    // Dust: tiny far stars that only show up as the visitor progresses.
    for (const d of this.dust) {
      const a = Math.max(0, prog - d.p / 9) * 0.5 * (0.6 + 0.4 * Math.sin(t * 0.7 + d.p)) * (1 - fade);
      if (a <= 0.01) continue;
      ctx.fillStyle = `rgba(233,228,216,${a})`;
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Where each star is drawn: its place, drifting onto a circle at the end.
    const lit = [...this.stars.values()].filter((s) => s.target === 1);
    const pos = new Map<string, [number, number]>();
    const R = Math.min(w, h) * 0.18;
    const [cx, cy] = [w / 2, h * 0.28];
    lit.forEach((s, i) => {
      const [px, py] = this.place(s.pos);
      // Ensō: the circle is left open, like a brush stroke.
      const ang = -Math.PI / 2 + (i / Math.max(1, lit.length)) * Math.PI * 1.85;
      const [ex, ey] = [cx + Math.cos(ang) * R, cy + Math.sin(ang) * R];
      const k = ease(sil);
      pos.set(s.id, [px + (ex - px) * k, py + (ey - py) * k]);
    });
    for (const s of this.stars.values()) if (!pos.has(s.id)) pos.set(s.id, this.place(s.pos));

    // Edges: the path as it was walked.
    ctx.lineWidth = 0.6;
    for (const e of this.edges) {
      const k = Math.min(1, Math.max(0, (t - e.t0) / 3));
      if (k <= 0) continue;
      const [ax, ay] = pos.get(e.from)!;
      const [bx, by] = pos.get(e.to)!;
      ctx.strokeStyle = `rgba(233,228,216,${0.16 * (1 - sil) * (1 - fade)})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + (bx - ax) * ease(k), ay + (by - ay) * ease(k));
      ctx.stroke();
    }

    // The ensō itself, drawn as the lights gather.
    if (sil > 0) {
      ctx.strokeStyle = `rgba(233,228,216,${0.22 * sil * (1 - fade)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 1.85 * ease(sil));
      ctx.stroke();
    }

    // Stars.
    for (const s of this.stars.values()) {
      s.level += (s.target - s.level) * (1 - Math.exp(-dt * 1.1));
      if (s.level < 0.004) continue;
      const [x, y] = pos.get(s.id)!;
      const flick = 0.9 + 0.1 * Math.sin(t * 1.3 + s.pos[0] * 9);
      const a = s.level * flick * (1 - fade);
      // A newly seen-through view blooms, then settles.
      const bloom = s.born ? Math.max(0, 1 - (t - s.born) / 5) : 0;
      const glow = 6 + 22 * s.level + 50 * bloom;
      const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
      g.addColorStop(0, `rgba(255,246,226,${0.42 * a})`);
      g.addColorStop(0.25, `rgba(255,246,226,${0.12 * a})`);
      g.addColorStop(1, "rgba(255,246,226,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, glow, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,250,240,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, 1 + 1.6 * s.level, 0, Math.PI * 2);
      ctx.fill();

      // Name, whispered once the view is seen through.
      if (s.target === 1) {
        s.label += (1 - s.label) * (1 - Math.exp(-dt * 0.4));
        ctx.fillStyle = `rgba(233,228,216,${0.42 * s.label * (1 - sil)})`;
        ctx.font = "italic 300 13px 'Cormorant Garamond', Georgia, serif";
        ctx.textAlign = "center";
        ctx.fillText(s.name, x, y + 20);
      }
    }

    requestAnimationFrame(this.frame);
  };
}

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
