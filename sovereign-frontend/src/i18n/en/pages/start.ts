// First-run onboarding page (pages/start.tsx) — English
export default {
  eyebrow: 'Getting started',
  title: 'Get set up in 6 steps',
  subtitle: 'Do them one at a time — the system remembers what you have already done',
  progressLabel: 'Done',
  stepsTitle: 'Steps',
  markDone: 'Done',
  open: 'Open page',
  skip: 'Skip for now',
  goDashboard: 'Go to Dashboard',
  footer: 'You can come back to this page any time at /start',
  steps: {
    password: {
      title: 'Set your own password',
      desc: 'If you are still using the password an admin gave you, change it to your own first',
    },
    sensors: {
      title: 'Check that sensors are connected',
      desc: 'See whether the sensors in the house are online and when they last reported',
    },
    energy: {
      title: 'Check power and battery',
      desc: 'Know how much charge is left and how many hours it will last',
    },
    inventory: {
      title: 'Record household supplies',
      desc: 'Food, water, fuel, medicine — know what is low before it runs out',
    },
    alerts: {
      title: 'Set up notifications',
      desc: 'Choose what the system should warn you about and where to send it',
    },
    health: {
      title: 'Run the first system check',
      desc: 'Verify the running code matches what was installed, the database is ready and nothing is stuck',
    },
  },
} as const;
