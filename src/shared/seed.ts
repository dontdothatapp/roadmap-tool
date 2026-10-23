import { todayDay } from './dates.ts';
import { MemoryHistory, RoadmapCore, emptyState } from './engine.ts';
import { DEFAULT_SPRINTS, SprintCalendar } from './sprints.ts';
import type { ChangeRecord, Item, Op, Outcome, PhaseKey, RoadmapState, Snapshot, Span } from './types.ts';
import { uid } from './util.ts';

// Example roadmap used for first runs and the in-browser demo. Every schedule is relative to the
// current sprint, and a few weeks of history (with a planning baseline) is generated so the
// History and Compare features have something to show.

type Range = [number, number];

interface Spec {
  id: string;
  title: string;
  team: string;
  track: string;
  status: Item['status'];
  /** Has a one-pager and a Jira epic. */
  key?: boolean;
  description: string;
  d?: Range;
  u?: Range;
  i?: Range;
  outcomes?: [stage: string, impact: number, unit: Outcome['unit'], ramp?: number[]][];
  deps?: [target: string, note: string, kind?: 'team'][];
}

const TEAMS = [
  { id: 'growth', name: 'Growth', color: '#4f5bd5', pm: 'Maya Chen', em: 'Arjun Mehta', ux: 'Lea Novak' },
  { id: 'checkout', name: 'Checkout', color: '#0f8a7e', pm: 'Leo Park', em: 'Nina Weber', ux: 'Chloe Martin' },
  { id: 'platform', name: 'Platform', color: '#475569', pm: 'David Okafor', em: 'Tom Becker', ux: '' },
  { id: 'mobile', name: 'Mobile App', color: '#7c3aed', pm: 'Sofia Rossi', em: 'Jonas Berg', ux: 'Chloe Martin' },
  { id: 'data', name: 'Data & ML', color: '#b45309', pm: 'Priya Nair', em: 'Omar Haddad', ux: '' },
];

const TRACKS = [
  { id: 'activation', name: 'Activation', color: '#0369a1', description: 'Get new users to their first moment of value faster.' },
  { id: 'conversion', name: 'Conversion', color: '#be185d', description: 'Turn intent into purchases and paid plans.', ownView: true },
  { id: 'retention', name: 'Retention', color: '#c2410c', description: 'Keep customers coming back.' },
  { id: 'foundations', name: 'Foundations', color: '#4d7c0f', description: 'Platform work that makes everything else faster and safer.' },
];

const PEOPLE = {
  maya: 'Maya Chen',
  leo: 'Leo Park',
  tom: 'Tom Becker',
  sofia: 'Sofia Rossi',
  priya: 'Priya Nair',
  david: 'David Okafor',
  chloe: 'Chloe Martin',
};

const SPECS: Spec[] = [
  {
    id: 'onboarding-personalization', title: 'Onboarding personalization', team: 'growth', track: 'activation', status: 'planned', key: true,
    description: 'Tailor the first-run experience to the use case people pick at sign-up, so they reach their first success in one session.',
    d: [-5, -3], u: [-3, -1], i: [-1, 3],
    outcomes: [['mid', 4, 'pp', [60]]],
    deps: [['event-tracking', 'Needs onboarding step events in the new schema']],
  },
  {
    id: 'referral-v2', title: 'Referral program v2', team: 'growth', track: 'activation', status: 'planned',
    description: 'Two-sided rewards and a shareable invite link inside the product.',
    d: [0, 2], u: [1, 3], i: [3, 7],
    outcomes: [['top', 6, '%']],
  },
  {
    id: 'pricing-experiments', title: 'Pricing page experiments', team: 'growth', track: 'conversion', status: 'planned',
    description: 'Series of A/B tests on plan packaging, annual discount framing and social proof.',
    d: [-1, 1], i: [2, 5],
    outcomes: [['bottom', 1.5, 'pp']],
    deps: [['experimentation', 'Need the experimentation platform for multi-variant tests']],
  },
  {
    id: 'seo-pages', title: 'SEO landing pages', team: 'growth', track: 'activation', status: 'planned',
    description: 'Programmatic landing pages for high-intent search terms.',
    d: [4, 6], i: [6, 9],
    outcomes: [['top', 15, '%']],
  },
  {
    id: 'co-marketing', title: 'Partner co-marketing pilot', team: 'growth', track: 'activation', status: 'planned',
    description: 'Joint campaign with two partners to test a new acquisition channel.',
    d: [1, 3],
  },
  {
    id: 'one-click-checkout', title: 'One-click checkout', team: 'checkout', track: 'conversion', status: 'planned', key: true,
    description: 'Returning customers pay with a saved method in a single tap. Biggest conversion lever on the roadmap this half.',
    d: [-6, -4], u: [-4, -1], i: [0, 4],
    outcomes: [['bottom', 3, '%', [50, 85]]],
    deps: [['payments-api', 'Tokenised saved payment methods']],
  },
  {
    id: 'wallets', title: 'Apple Pay & Google Pay', team: 'checkout', track: 'conversion', status: 'planned',
    description: 'Native wallets on web and in the app.',
    u: [1, 2], i: [3, 6],
    deps: [['payments-api', 'Wallet tokens in the new payments API']],
  },
  {
    id: 'cart-emails', title: 'Cart abandonment emails', team: 'checkout', track: 'conversion', status: 'planned',
    description: 'Triggered reminder sequence with the cart contents and a deep link back to checkout.',
    u: [-2, -1], i: [-1, 1],
    outcomes: [['bottom', 8, '%']],
  },
  {
    id: 'checkout-perf', title: 'Checkout performance', team: 'checkout', track: 'foundations', status: 'planned',
    description: 'Cut checkout page load (p75) from 3.1s to under 1.5s.',
    i: [-4, -1],
    outcomes: [['bottom', 0.5, '%']],
  },
  {
    id: 'payments-api', title: 'Payments API v2', team: 'platform', track: 'foundations', status: 'planned', key: true,
    description: 'New payments service with tokenised payment methods, idempotent charges and wallet support.',
    d: [-7, -5], i: [-4, 1],
  },
  {
    id: 'design-tokens', title: 'Design system tokens', team: 'platform', track: 'foundations', status: 'planned',
    description: 'Shared colour, type and spacing tokens across web and app.',
    u: [-3, 0], i: [-1, 2],
  },
  {
    id: 'feature-flags', title: 'Feature flag service', team: 'platform', track: 'foundations', status: 'planned',
    description: 'Self-serve flags with percentage rollouts and audit log.',
    d: [-1, 0], i: [0, 3],
  },
  {
    id: 'observability', title: 'Observability upgrade', team: 'platform', track: 'foundations', status: 'planned',
    description: 'Tracing across services and SLO dashboards for every team.',
    i: [4, 8],
  },
  {
    id: 'mobile-onboarding', title: 'Mobile onboarding redesign', team: 'mobile', track: 'activation', status: 'planned', key: true,
    description: 'Bring the personalised onboarding to the app, using the new design system.',
    d: [-2, 0], u: [0, 3], i: [3, 7],
    outcomes: [['mid', 3, 'pp']],
    deps: [
      ['onboarding-personalization', 'Reuse the personalisation rules and copy'],
      ['design-tokens', 'Tokens available in the app'],
    ],
  },
  {
    id: 'push-preferences', title: 'Push notification preferences', team: 'mobile', track: 'retention', status: 'planned',
    description: 'Let people choose topics and quiet hours instead of all-or-nothing.',
    u: [-2, -1], i: [-1, 2],
    outcomes: [['retention', 1, 'pp']],
  },
  {
    id: 'offline-mode', title: 'Offline mode', team: 'mobile', track: 'retention', status: 'planned',
    description: 'Browse saved content and queue actions without a connection.',
    d: [3, 5], u: [5, 7], i: [7, 12],
    outcomes: [['retention', 2, '%']],
    deps: [['platform', 'Sync API endpoints for the offline action queue', 'team']],
  },
  {
    id: 'app-quality', title: 'Crash-free sessions push', team: 'mobile', track: 'foundations', status: 'planned',
    description: 'Fix the top 20 crashes and add release health gates.',
    i: [2, 4],
  },
  {
    id: 'event-tracking', title: 'Unified event tracking', team: 'data', track: 'foundations', status: 'planned', key: true,
    description: 'One event schema and pipeline for web, app and backend.',
    d: [-6, -4], i: [-4, 0],
  },
  {
    id: 'experimentation', title: 'Experimentation platform', team: 'data', track: 'foundations', status: 'planned',
    description: 'Assignment, exposure logging and automated readouts.',
    d: [-1, 1], i: [1, 5],
  },
  {
    id: 'recommendations', title: 'Recommendations engine v1', team: 'data', track: 'retention', status: 'planned',
    description: '“Picked for you” on home and in emails, trained on the unified events.',
    d: [-1, 2], u: [2, 3], i: [3, 8],
    outcomes: [
      ['retention', 4, '%'],
      ['bottom', 2, '%'],
    ],
    deps: [['event-tracking', 'Clean event history for training']],
  },
  {
    id: 'churn-model', title: 'Churn prediction model', team: 'data', track: 'retention', status: 'planned',
    description: 'Score accounts weekly so lifecycle and support can intervene early.',
    d: [5, 8], i: [8, 11],
    outcomes: [['retention', 1.5, 'pp']],
  },
  // Backlog: ideas with no dates yet.
  {
    id: 'winback-emails', title: 'Win-back email series', team: 'growth', track: 'retention', status: 'planned',
    description: 'Bring lapsed users back with a three-step email series.',
    outcomes: [['retention', 2, 'pp']],
  },
  {
    id: 'social-proof', title: 'Social proof on the pricing page', team: 'growth', track: 'conversion', status: 'planned',
    description: 'Logos, reviews and usage numbers next to the plans.',
    outcomes: [['bottom', 1, 'pp']],
  },
  {
    id: 'bnpl', title: 'Buy now, pay later', team: 'checkout', track: 'conversion', status: 'planned',
    description: 'Instalments for larger baskets.',
    outcomes: [['bottom', 2, '%']],
  },
  {
    id: 'rate-limits', title: 'Rate limiting v2', team: 'platform', track: 'foundations', status: 'planned',
    description: 'Per-customer limits with clear headers.',
  },
  {
    id: 'ios-widgets', title: 'Home screen widgets', team: 'mobile', track: 'retention', status: 'planned',
    description: 'Glanceable widgets for iOS and Android.',
    outcomes: [['retention', 1, '%']],
  },
  {
    id: 'anomaly-alerts', title: 'Metric anomaly alerts', team: 'data', track: 'foundations', status: 'planned',
    description: 'Alert owners when a key metric moves unexpectedly.',
  },
];

export interface DemoData {
  state: RoadmapState;
  changes: ChangeRecord[];
  snapshots: Snapshot[];
}

export function generateDemo(now: Date = new Date()): DemoData {
  const cal = new SprintCalendar(DEFAULT_SPRINTS);
  const cur = cal.indexOf(todayDay(now));
  const span = (r: Range): Span => cal.spanFromIndexes(cur + r[0], cur + r[1]);
  const DAY = 86_400_000;
  const at = (daysAgo: number, hour = 10, minute = 0) => {
    const t = new Date(now.getTime() - daysAgo * DAY);
    t.setHours(hour, minute, 0, 0);
    return t.getTime() >= now.getTime() ? new Date(now.getTime() - 60_000) : t;
  };

  const history = new MemoryHistory();
  const core = new RoadmapCore(emptyState(), history);
  const submit = (actor: string, when: Date, ops: Op[]) => core.submit(ops, { actor, clientId: null, now: when });

  submit(PEOPLE.david, at(36, 9), [
    { kind: 'update', entity: 'settings', id: 'settings', patch: { name: 'Product roadmap' } },
    ...TEAMS.map((t, i): Op => ({ kind: 'create', entity: 'team', id: t.id, data: { ...t, order: i } })),
    ...TRACKS.map((t, i): Op => ({ kind: 'create', entity: 'track', id: t.id, data: { ...t, order: i } })),
  ]);

  const ownerOf: Record<string, string> = { growth: PEOPLE.maya, checkout: PEOPLE.leo, platform: PEOPLE.tom, mobile: PEOPLE.sofia, data: PEOPLE.priya };
  TEAMS.forEach((team, ti) => {
    const ops: Op[] = SPECS.filter((s) => s.team === team.id).map((s, i): Op => {
      const phases: Partial<Record<PhaseKey, Span>> = {};
      if (s.d) phases.discovery = span(s.d);
      if (s.u) phases.ux = span(s.u);
      if (s.i) phases.implementation = span(s.i);
      return {
        kind: 'create',
        entity: 'item',
        id: s.id,
        data: {
          title: s.title,
          teamId: s.team,
          trackId: s.track,
          status: s.status,
          description: s.description,
          phases,
          onePagerUrl: s.key ? `https://docs.example.com/one-pagers/${s.id}` : '',
          links: s.key ? [{ id: uid(), label: 'Jira epic', url: `https://jira.example.com/browse/${s.team.toUpperCase().slice(0, 3)}-${100 + i}` }] : [],
          outcomes: (s.outcomes ?? []).map(([stageId, impact, unit, ramp]) => ({
            id: uid(), stageId, metric: '', impact, unit, confidence: 'medium', landsBy: null, ramp: ramp ?? [], note: '',
          })),
          dependencies: (s.deps ?? [])
            .filter(([target]) => !(s.id === 'experimentation' && target === 'feature-flags'))
            .map(([target, note, kind]) => ({
              id: uid(),
              itemId: kind === 'team' ? null : target,
              teamId: kind === 'team' ? target : null,
              status: 'open' as const,
              note,
            })),
          order: i,
        },
      };
    });
    submit(ownerOf[team.id], at(35 - ti * 0.5, 11 + ti), ops);
  });

  const snapshots: Snapshot[] = [
    { id: uid(), name: 'Quarterly planning baseline', note: 'Agreed in the planning session with all teams.', ts: at(33, 17).toISOString(), actor: PEOPLE.david },
  ];
  history.snapshotTimes.push(snapshots[0].ts);

  const item = (id: string) => core.state.items[id];
  const shift = (id: string, phase: PhaseKey, n: number) => ({
    phases: { ...item(id).phases, [phase]: cal.shiftSpan(item(id).phases[phase]!, n) },
  });
  const update = (id: string, patch: Record<string, unknown>): Op => ({ kind: 'update', entity: 'item', id, patch });

  submit(PEOPLE.priya, at(30, 14, 20), [update('event-tracking', { description: 'One event schema across web, app and backend. Web and backend are sending; the app follows.' })]);
  submit(PEOPLE.chloe, at(27, 11, 5), [update('design-tokens', { description: 'Shared colour, type and spacing tokens across web and app. Web is live; the app follows next sprint.' })]);
  submit(PEOPLE.tom, at(24, 16, 40), [
    update('payments-api', {
      ...shift('payments-api', 'implementation', 2),
      description: 'New payments service with tokenised payment methods, idempotent charges and wallet support. Card vault migration took longer than planned, so delivery moved by two sprints.',
    }),
  ]);
  submit(PEOPLE.leo, at(23, 9, 15), [update('one-click-checkout', { status: 'at_risk' })]);
  // The team splits one-click checkout into parts it plans one by one; leadership still sees one initiative.
  const occParts: [id: string, title: string, phases: Partial<Record<PhaseKey, Span>>, row: number][] = [
    ['occ-design', 'Discovery & design', { discovery: span([-6, -4]), ux: span([-4, -1]) }, 0],
    ['occ-core', 'Core flow', { implementation: span([0, 2]) }, 0],
    ['occ-rollout', 'Rollout & tuning', { implementation: span([2, 4]) }, 0],
    ['occ-express', 'Express buttons on product pages', { implementation: span([1, 3]) }, 1],
  ];
  submit(PEOPLE.leo, at(20, 11, 30), [
    ...occParts.map(([id, title, phases, row], k): Op => ({
      kind: 'create',
      entity: 'item',
      id,
      data: { title, teamId: 'checkout', trackId: 'conversion', phases, row, parentId: 'one-click-checkout', order: 0.1 * (k + 1) },
    })),
    update('one-click-checkout', { phases: {} }),
  ]);
  submit(PEOPLE.priya, at(21, 13, 0), [
    update('experimentation', {
      dependencies: [...item('experimentation').dependencies, { id: uid(), itemId: 'feature-flags', teamId: null, status: 'agreed', note: 'Flags drive experiment assignment' }],
    }),
  ]);
  snapshots.push({ id: uid(), name: 'Leadership sync', note: 'Monthly review with the leadership group.', ts: at(17, 15).toISOString(), actor: PEOPLE.david });
  history.snapshotTimes.push(snapshots[1].ts);
  submit(PEOPLE.david, at(16, 10, 30), [update('recommendations', { onePagerUrl: 'https://docs.example.com/one-pagers/recommendations' })]);
  submit(PEOPLE.maya, at(13, 11, 45), [update('referral-v2', shift('referral-v2', 'implementation', 1))]);
  submit(PEOPLE.maya, at(12, 15, 10), [{ kind: 'delete', entity: 'item', id: 'co-marketing' }]);
  submit(PEOPLE.tom, at(9, 10, 0), [update('feature-flags', { phases: { ...item('feature-flags').phases, implementation: cal.spanFromIndexes(cur, cur + 2) } })]);
  submit(PEOPLE.leo, at(7, 14, 30), [
    update('wallets', {
      outcomes: [{ id: uid(), stageId: 'bottom', metric: '', impact: 1.5, unit: '%', confidence: 'medium', landsBy: null, ramp: [40, 80], note: 'Mostly mobile web' }],
    }),
  ]);
  submit(PEOPLE.sofia, at(5, 12, 0), [
    {
      kind: 'create', entity: 'item', id: 'review-prompts',
      data: {
        title: 'In-app review prompts', teamId: 'mobile', trackId: 'retention', status: 'planned',
        description: 'Ask happy users for a store review at the right moment.',
        phases: { implementation: span([2, 3]) }, order: 10,
      },
    },
  ]);
  submit(PEOPLE.chloe, at(2, 10, 10), [update('mobile-onboarding', { phases: { ...item('mobile-onboarding').phases, ux: span([0, 2]) } })]);
  submit(PEOPLE.leo, at(1, 9, 40), [update('cart-emails', { description: 'Remind people of what they left in the cart, one hour and one day later.' })]);

  return { state: core.state, changes: history.changes, snapshots };
}
