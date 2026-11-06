import type { IngestConfig } from "../config";
import { adzunaSource, arbeitnowSource, remotiveSource } from "./aggregators";
import { amazonSource } from "./amazon";
import { ashbySource } from "./ashby";
import { greenhouseSource } from "./greenhouse";
import { leverSource } from "./lever";
import { recruiteeSource } from "./recruitee";
import { smartRecruitersSource } from "./smartrecruiters";
import type { Source } from "./types";
import { workdaySource } from "./workday";

export type { Logger, Source, SourceContext } from "./types";

/** A company a user added to their watchlist (board-token based ATS only). */
export interface WatchedBoard {
  atsType: "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "recruitee";
  boardToken: string;
  companyName: string;
}

const TOKEN = /^[A-Za-z0-9._-]{1,100}$/;

export interface BuildOptions {
  watched?: readonly WatchedBoard[];
  adzunaCredentials?: { appId: string; appKey: string } | null;
  includeAggregators?: boolean;
}

/** Turn config plus watchlist into a de-duplicated list of sources. */
export function buildSources(config: IngestConfig, options: BuildOptions = {}): Source[] {
  const { watched = [], adzunaCredentials = null, includeAggregators = true } = options;
  const sources = new Map<string, Source>();
  const add = (source: Source) => {
    if (!sources.has(source.id)) sources.set(source.id, source);
  };

  config.greenhouse.forEach((c) => add(greenhouseSource(c)));
  config.lever.forEach((c) => add(leverSource(c)));
  config.ashby.forEach((c) => add(ashbySource(c)));
  config.recruitee.forEach((c) => add(recruiteeSource(c)));
  config.smartrecruiters.forEach((c) => add(smartRecruitersSource(c)));
  config.workday.forEach((c) => add(workdaySource(c)));
  config.amazon.forEach((c) => add(amazonSource(c)));

  for (const board of watched) {
    // The database already constrains tokens; re-check because they become URL parts.
    if (!TOKEN.test(board.boardToken)) continue;
    const entry = { token: board.boardToken, name: board.companyName };
    switch (board.atsType) {
      case "greenhouse":
        add(greenhouseSource(entry));
        break;
      case "lever":
        add(leverSource(entry));
        break;
      case "ashby":
        add(ashbySource(entry));
        break;
      case "recruitee":
        add(recruiteeSource(entry));
        break;
      case "smartrecruiters":
        add(smartRecruitersSource({ ...entry, max: 150 }));
        break;
    }
  }

  if (includeAggregators) {
    if (config.arbeitnow) add(arbeitnowSource(config.arbeitnow));
    if (config.remotive) add(remotiveSource(config.remotive));
    if (config.adzuna && adzunaCredentials) add(adzunaSource({ ...config.adzuna, ...adzunaCredentials }));
  }

  return [...sources.values()];
}
