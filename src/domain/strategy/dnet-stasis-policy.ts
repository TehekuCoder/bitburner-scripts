export interface DnetStasisCandidate {
  hostname: string;
  depth: number;
  isOnline: boolean;
  isStationary: boolean;
  hasCrawler: boolean;
}

export type DnetStasisAction = "link" | "unlink" | null;

export function chooseDnetStasisAction(
  currentHost: string,
  candidates: readonly DnetStasisCandidate[],
  linkedHosts: readonly string[],
  linkLimit: number,
): DnetStasisAction {
  if (!Number.isFinite(linkLimit) || linkLimit <= 0) return null;

  const onlineCandidates = candidates
    .filter(
      (candidate) =>
        candidate.isOnline &&
        Number.isFinite(candidate.depth) &&
        candidate.depth >= 0,
    )
    .sort((a, b) => b.depth - a.depth || a.hostname.localeCompare(b.hostname));
  const linked = [...new Set(linkedHosts)];
  const unlinkedCandidates = onlineCandidates.filter(
    (candidate) =>
      !candidate.isStationary &&
      candidate.hasCrawler &&
      !linked.includes(candidate.hostname),
  );
  const deepestCandidate = unlinkedCandidates[0];

  const linkedCandidates = linked
    .map((hostname) =>
      onlineCandidates.find((candidate) => candidate.hostname === hostname),
    )
    .filter((candidate): candidate is DnetStasisCandidate => candidate !== undefined)
    .sort((a, b) => a.depth - b.depth || a.hostname.localeCompare(b.hostname));
  const shallowestLink = linkedCandidates[0];
  const limit = Math.floor(linkLimit);

  if (linked.length < limit) {
    return deepestCandidate?.hostname === currentHost ? "link" : null;
  }

  if (
    shallowestLink &&
    (linked.length > limit ||
      (deepestCandidate && deepestCandidate.depth > shallowestLink.depth)) &&
    shallowestLink.hostname === currentHost
  ) {
    return "unlink";
  }

  return null;
}
