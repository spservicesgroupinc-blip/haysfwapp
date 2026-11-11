import { updateWorkspaceRow } from "./localStore";
import type { Workspace } from "./types";

/** Import review and the device write share a compare-and-save boundary. */
export async function importWorkspaceLocally(
  workspace: Workspace,
  reviewed?: Workspace,
): Promise<void> {
  await updateWorkspaceRow(workspace.id, (current) => {
    if (
      current &&
      JSON.stringify(current.workspace) === JSON.stringify(workspace)
    )
      return current;
    if (
      current &&
      (!reviewed ||
        JSON.stringify(current.workspace) !== JSON.stringify(reviewed))
    )
      throw new Error(
        "This job changed after the import preview. Reopen the export to review the latest job before merging.",
      );
    return {
      ...current,
      workspace: {
        ...structuredClone(workspace),
        updatedAt: new Date().toISOString(),
      },
      serverRevision: current?.serverRevision ?? workspace.revision,
      dirty: true,
      error: undefined,
    };
  });
}
