import type {AgentRun} from './agent-types';
import type {Recipe} from './types';

export function repeatedDinners(recipes: Recipe[]) {
  const ids = new Set<string>(), sources = new Set<string>(), titles = new Set<string>();
  return recipes.filter(recipe => {
    const title = recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const source = recipe.source.split(/[?#]/)[0].replace(/\/$/, '');
    const repeated = ids.has(recipe.id) || (source && sources.has(source)) || titles.has(title);
    ids.add(recipe.id); sources.add(source); titles.add(title);
    return repeated;
  });
}

export function actionLabel(tool: string, args: Record<string, unknown> = {}) {
  switch (tool) {
    case 'search_recipes': return `Searching ${typeof args.cuisine === 'string' ? args.cuisine.slice(0,60) + ' ' : ''}recipes that fit your preferences`;
    case 'fetch_recipe': return 'Reading the published recipe and its ingredients';
    case 'search_products': return 'Looking for matching Kroger packages and prices';
    case 'build_basket': return 'Pricing whole packages and checking your weekly budget';
    case 'save_proposal': return 'Saving your dinners and grocery basket for review';
    case 'inspect_approved_plan': return 'Checking the exact plan you approved';
    case 'submit_test_order': return 'Processing payment and placing your order in demo mode';
    case 'get_order_status': return 'Verifying the saved payment and delivery status';
    case 'finish': return 'Confirming the order result';
    default: return 'Checking what is needed to continue';
  }
}

export function actionResult(tool: string, run: AgentRun, result: unknown, failed: boolean) {
  if (failed) {
    const error = (result as {error?: string})?.error || '';
    if (/distinct dinner/.test(error)) return 'This menu repeats a dinner. A different dish is needed before pricing.';
    if (/Selected product was not returned/.test(error)) return 'That product does not match the required ingredient at your store. Another match is needed.';
    return `Could not complete this step: ${actionLabel(tool).toLowerCase()}.`;
  }
  if (tool === 'report_blocker') return 'Planning stopped because the required recipe or pricing checks could not be completed. No order was placed.';
  if (tool === 'search_recipes') {
    const count = (result as {recipes?: unknown[]})?.recipes?.length || 0;
    return `Retrieved ${count} published recipe${count === 1 ? '' : 's'} with ingredients and cooking times.`;
  }
  if (tool === 'build_basket' && run.candidate) {
    const plan = run.candidate;
    if (!plan.simulationQuote) return 'Some ingredients still need a matching price. The basket is not ready for approval.';
    const total = `$${(plan.totalCents / 100).toFixed(2)}`;
    const cap = `$${(run.preferences.budgetCents / 100).toFixed(2)}`;
    return plan.totalCents > run.preferences.budgetCents
      ? `The ${total} basket exceeds your ${cap} cap. Cheaper dinners are needed.`
      : `Every ingredient is priced. ${total} including simulated charges, within your ${cap} cap.`;
  }
  if (tool === 'search_products') return 'Checked Kroger product matches and available package prices.';
  if (tool === 'save_proposal') return 'Your plan is saved. Ordering still needs your approval.';
  if (tool === 'fetch_recipe') return 'Retrieved the published recipe details.';
  if (tool === 'submit_test_order') return 'Checkout action returned. Checking the saved result next.';
  if (tool === 'get_order_status') return 'Read the saved payment and order status.';
  if (tool === 'inspect_approved_plan') return 'Read the approved plan, budget, and payment state.';
  if (tool === 'finish') return 'Order check finished. See the saved result for details.';
  return 'Checked the next steps needed for this plan.';
}
