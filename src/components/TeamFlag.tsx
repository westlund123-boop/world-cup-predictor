// Maps FIFA 3-letter codes to flagcdn slugs (ISO 3166-1 alpha-2, plus GB subdivisions).
// flagcdn.com renders consistent SVG flags across all platforms, including Windows
// where regional-indicator emoji render as letter pairs instead of flags.
const FIFA_TO_FLAGCDN: Record<string, string> = {
  ALG: "dz", ARG: "ar", AUS: "au", AUT: "at", BEL: "be", BIH: "ba", BRA: "br",
  CAN: "ca", CIV: "ci", COD: "cd", COL: "co", CPV: "cv", CRO: "hr", CUW: "cw",
  CZE: "cz", ECU: "ec", EGY: "eg", ENG: "gb-eng", ESP: "es", FRA: "fr", GER: "de",
  GHA: "gh", HAI: "ht", IRN: "ir", IRQ: "iq", JOR: "jo", JPN: "jp", KOR: "kr",
  KSA: "sa", MAR: "ma", MEX: "mx", NED: "nl", NOR: "no", NZL: "nz", PAN: "pa",
  PAR: "py", POR: "pt", QAT: "qa", RSA: "za", SCO: "gb-sct", SEN: "sn", SUI: "ch",
  SWE: "se", TUN: "tn", TUR: "tr", URU: "uy", USA: "us", UZB: "uz",
};

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<Size, { w: number; h: number; cdn: 20 | 40 | 80 | 160 }> = {
  sm: { w: 20, h: 15, cdn: 40 },
  md: { w: 28, h: 21, cdn: 40 },
  lg: { w: 36, h: 27, cdn: 80 },
  xl: { w: 48, h: 36, cdn: 80 },
};

export function TeamFlag({
  code,
  name,
  size = "md",
  className = "",
}: {
  code: string | null | undefined;
  name?: string | null;
  size?: Size;
  className?: string;
}) {
  const slug = code ? FIFA_TO_FLAGCDN[code.toUpperCase()] : undefined;
  const { w, h, cdn } = SIZE_PX[size];

  if (!slug) {
    return (
      <span
        aria-label={name ?? code ?? "flag"}
        className={`inline-block bg-muted rounded-sm ${className}`}
        style={{ width: w, height: h }}
      />
    );
  }

  return (
    <img
      src={`https://flagcdn.com/w${cdn}/${slug}.png`}
      srcSet={`https://flagcdn.com/w${cdn * 2}/${slug}.png 2x`}
      width={w}
      height={h}
      alt={name ? `${name} flag` : `${code} flag`}
      loading="lazy"
      className={`inline-block object-cover rounded-sm shadow-sm ${className}`}
      style={{ width: w, height: h }}
    />
  );
}
