-- Project budgets are estimates; the accepted quote must still meet the checkout minimum.
alter table public.tasks drop constraint tasks_checkout_minimum;
alter table public.tasks add constraint tasks_checkout_minimum check (pricing_rule_version=0 or service_kind='project' or offered_price>=10);
