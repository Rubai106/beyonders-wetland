export type DrawerAnchorTab = {
  id: string;
  anchorIds?: readonly string[];
};

/** Resolve a deep-linked section to the drawer tab that renders its anchor. */
export function findDrawerTabForAnchor<T extends DrawerAnchorTab>(
  tabs: readonly T[] | null | undefined,
  anchorId: string | null | undefined,
): T | undefined {
  if (!anchorId || !tabs?.length) return undefined;
  return tabs.find((tab) => tab.anchorIds?.includes(anchorId));
}
