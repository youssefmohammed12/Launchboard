import { SYSTEM_ACTIVITY_TYPE, type LaunchboardBackup } from '@launchboard/domain';
import type { Opportunity, OpportunityStatus } from '../types/opportunity';
import { apiJson } from './apiClient';

export type ArchiveView = 'active' | 'archived';

export interface OpportunityResource {
  opportunity: Opportunity;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityCollection {
  revision: number;
  items: OpportunityResource[];
}

export interface VersionedOpportunityRef {
  id: string;
  expectedVersion: number;
}

export interface ArchiveUndoRef {
  id: string;
  expectedArchivedAt: string | null;
  previousArchivedAt: string | null;
}

export interface DeletionBatch {
  deletionBatchId: string;
  expiresAt: string;
  deleted: Array<{ id: string; version: number }>;
}

export interface BackupImportRequest {
  mode: 'merge' | 'replace';
  backup: LaunchboardBackup;
  dryRun?: boolean;
  confirmReplace?: boolean;
  expectedRevision?: number;
}

export interface BackupImportResult {
  mode: 'merge' | 'replace';
  dryRun: boolean;
  revision: number;
  totalRecords: number;
  validRecords: number;
  repairedRecords: number;
  invalidRecords: number;
  duplicateRecords: number;
  added: number;
  skippedExisting: number;
  replaced: number;
  finalCount: number;
  skipped: Array<{ index: number; id: string | null; reason: string }>;
}

function writableOpportunity(opportunity: Opportunity): Omit<Opportunity, 'archivedAt'> {
  const result = { ...opportunity };
  delete result.archivedAt;
  // Demo provenance is an import/export concern; normal writes may only send
  // false/omitted so a user edit never tries to preserve a server demo marker.
  if (result.isDemo) delete result.isDemo;
  return result;
}

function ifMatch(version: number): HeadersInit {
  return { 'If-Match': `"${version}"` };
}

/**
 * Authenticated HTTP adapter for the versioned opportunity API.
 * It exposes endpoint-shaped operations; the server owns versions, ordering
 * and transaction boundaries.
 */
export class HttpOpportunityRepository {
  async load(archived: 'active' | 'archived' | 'all' = 'all'): Promise<OpportunityCollection> {
    const query = new URLSearchParams({ archived });
    return apiJson<OpportunityCollection>(`/opportunities?${query.toString()}`);
  }

  async get(id: string): Promise<OpportunityResource> {
    return apiJson<OpportunityResource>(`/opportunities/${encodeURIComponent(id)}`);
  }

  async create(opportunity: Opportunity): Promise<OpportunityResource> {
    return apiJson<OpportunityResource>('/opportunities', {
      method: 'POST',
      body: { opportunity: writableOpportunity(opportunity) },
      csrfContext: 'authenticated',
    });
  }

  async update(
    id: string,
    expectedVersion: number,
    previous: Opportunity,
    opportunity: Opportunity,
    statusActivityDate?: string,
  ): Promise<OpportunityResource> {
    // Existing server-generated status history must be echoed exactly, but a
    // newly-created client-side entry must not be submitted: the API owns it.
    const existingSystemActivityIds = new Set(
      previous.activities
        .filter((activity) => activity.type === SYSTEM_ACTIVITY_TYPE)
        .map((activity) => activity.id),
    );
    const safeOpportunity: Opportunity = {
      ...opportunity,
      activities: opportunity.activities.filter(
        (activity) =>
          activity.type !== SYSTEM_ACTIVITY_TYPE ||
          existingSystemActivityIds.has(activity.id),
      ),
    };

    return apiJson<OpportunityResource>(`/opportunities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: ifMatch(expectedVersion),
      body: {
        opportunity: writableOpportunity(safeOpportunity),
        ...(statusActivityDate ? { statusActivityDate } : {}),
      },
      csrfContext: 'authenticated',
    });
  }

  async archive(id: string, expectedVersion: number): Promise<OpportunityResource> {
    return apiJson<OpportunityResource>(`/opportunities/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      headers: ifMatch(expectedVersion),
      body: {},
      csrfContext: 'authenticated',
    });
  }

  async restore(id: string, expectedVersion: number): Promise<OpportunityResource> {
    return apiJson<OpportunityResource>(`/opportunities/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      headers: ifMatch(expectedVersion),
      body: {},
      csrfContext: 'authenticated',
    });
  }

  async remove(id: string, expectedVersion: number): Promise<DeletionBatch> {
    return apiJson<DeletionBatch>(`/opportunities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: ifMatch(expectedVersion),
      json: true,
      csrfContext: 'authenticated',
    });
  }

  async bulkArchive(items: VersionedOpportunityRef[]) {
    return apiJson<{ revision: number; items: OpportunityResource[] }>('/opportunities/bulk/archive', {
      method: 'POST',
      body: { items },
      csrfContext: 'authenticated',
    });
  }

  async bulkRestore(items: VersionedOpportunityRef[]) {
    return apiJson<{ revision: number; items: OpportunityResource[] }>('/opportunities/bulk/restore', {
      method: 'POST',
      body: { items },
      csrfContext: 'authenticated',
    });
  }

  async bulkStatus(
    items: VersionedOpportunityRef[],
    status: OpportunityStatus,
    statusActivityDate: string,
  ) {
    return apiJson<{ revision: number; items: OpportunityResource[] }>('/opportunities/bulk/status', {
      method: 'POST',
      body: { items, status, statusActivityDate },
      csrfContext: 'authenticated',
    });
  }

  async bulkDelete(items: VersionedOpportunityRef[], archiveView: ArchiveView): Promise<DeletionBatch> {
    return apiJson<DeletionBatch>('/opportunities/bulk/delete', {
      method: 'POST',
      body: { items, archiveView },
      csrfContext: 'authenticated',
    });
  }

  async undoArchive(items: ArchiveUndoRef[]) {
    return apiJson<{ revision: number; items: OpportunityResource[] }>('/opportunities/bulk/undo-archive', {
      method: 'POST',
      body: { items },
      csrfContext: 'authenticated',
    });
  }

  async restoreDeletion(batchId: string) {
    return apiJson<{ revision: number; items: OpportunityResource[] }>(
      `/opportunities/deletions/${encodeURIComponent(batchId)}/restore`,
      {
        method: 'POST',
        body: {},
        csrfContext: 'authenticated',
      },
    );
  }

  async importBackup(input: BackupImportRequest): Promise<BackupImportResult> {
    return apiJson<BackupImportResult>('/opportunities/import', {
      method: 'POST',
      body: input,
      csrfContext: 'authenticated',
    });
  }

  async exportBackup(): Promise<LaunchboardBackup> {
    return apiJson<LaunchboardBackup>('/opportunities/export');
  }
}

export const httpOpportunityRepository = new HttpOpportunityRepository();
