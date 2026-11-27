import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import {
  approveInvoiceReview, createQuote, declineInvoiceReview, deleteQuote, deleteStoredFiles, filePaperwork,
  getPendingReviews, getProject, getProjectPrices, getSupplierNames, payBill, setQuoteStatus,
  updateProject, updateQuote,
} from '../lib/supabase';
import { billOutstanding, dayKey, inclGst, projectLedger, type ProjectLedger } from '@snag/supabase-queries';
import { useToast } from './useToast';
import type { NewPrice } from '../components/AddPriceSheet';
import type { InvoiceReview, Project, ProjectQuote } from '../types';

/**
 * One project's money for the project page and a supplier's page: the
 * project, its prices, the emailed papers waiting, and every write either
 * page can make. Three reads, and the last two never take the page down.
 *
 * **Accepting a quote starts the project** (the owner's decision): a planned
 * job whose quote is accepted becomes underway, started today.
 */
export function useProjectMoney(projectId: string) {
  const { showToast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [prices, setPrices] = useState<ProjectQuote[] | null>(null);
  const [reviews, setReviews] = useState<InvoiceReview[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const run = useRef(0);

  const load = useCallback(async () => {
    const mine = ++run.current;
    try {
      const [p, byProject] = await Promise.all([getProject(projectId), getProjectPrices([projectId])]);
      if (mine !== run.current) return;
      setProject(p);
      setPrices(byProject.get(projectId) ?? []);
      setFailed(false);
    } catch {
      if (mine === run.current) setFailed(true);
      return;
    }
    getPendingReviews(projectId).then(
      (r) => mine === run.current && setReviews(r),
      () => undefined,
    );
    getSupplierNames().then(setSuppliers, () => undefined);
  }, [projectId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const ledger: ProjectLedger | null = useMemo(
    () => (project && prices ? projectLedger(prices, inclGst(project.budget, project.budgetInclGst)) : null),
    [project, prices],
  );

  async function act(work: () => Promise<unknown>, toast: string): Promise<boolean> {
    try {
      await work();
      showToast(toast);
      await load();
      return true;
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : "That didn't save");
      return false;
    }
  }

  return {
    project,
    prices: prices ?? [],
    ledger,
    reviews,
    suppliers,
    failed,
    reload: load,

    accept: (price: ProjectQuote) => act(async () => {
      await setQuoteStatus(price.id, 'accepted');
      if (project?.status === 'planned') {
        await updateProject(projectId, { status: 'underway', startedOn: project.startedOn ?? dayKey(new Date()) });
      }
    }, project?.status === 'planned' ? 'Accepted · project started' : 'Accepted'),

    pay: (price: ProjectQuote, paidOn: string) =>
      act(() => payBill(price.id, billOutstanding(price), paidOn), 'Paid'),

    files: (price: ProjectQuote, next: { photoPaths?: string[]; documentPaths?: string[] }, toast: string) =>
      act(() => updateQuote(price.id, next), toast).then(() => undefined),

    remove: (price: ProjectQuote) => act(async () => {
      const orphaned = await deleteQuote(price.id);
      await deleteStoredFiles(orphaned);
    }, 'Deleted'),

    add: async (input: NewPrice): Promise<boolean> => act(async () => {
      const created = await createQuote({
        projectId,
        kind: input.kind,
        supplier: input.supplier,
        amount: input.amount,
        amountInclGst: input.amountInclGst,
        invoiceNumber: input.invoiceNumber,
        dated: input.dated,
      });
      if (input.paid) {
        await payBill(created.id, inclGst(input.amount, input.amountInclGst) ?? 0, input.dated ?? dayKey(new Date()));
      }
    }, input.kind === 'quote' ? 'Quote added' : input.paid ? 'Invoice added · paid' : 'Invoice added'),

    /** An emailed paper onto the job: a bill or quote as itself, paperwork onto the job's files. */
    keepReview: (review: InvoiceReview) => act(
      () => (review.kind === 'paperwork' ? filePaperwork(review.id, {}) : approveInvoiceReview(review.id, {})),
      review.kind === 'paperwork' ? 'Filed' : 'Added',
    ),
    dropReview: (review: InvoiceReview) => act(() => declineInvoiceReview(review.id), 'Removed'),

    rename: async (name: string) => {
      await updateProject(projectId, { name });
      await load();
    },
    saveStatus: (update: Parameters<typeof updateProject>[1]) => act(() => updateProject(projectId, update), 'Saved'),
    saveBudget: (budget: number | null, budgetInclGst: boolean) =>
      act(() => updateProject(projectId, { budget, budgetInclGst }), 'Budget saved'),
  };
}
