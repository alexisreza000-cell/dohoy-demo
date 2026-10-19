-- DOHOY 5.8.4: protect anonymous RPC access and enforce payable MXN amounts.
revoke execute on function public.admin_attention_summary() from public, anon;
revoke execute on function public.admin_business_metrics() from public, anon;
revoke execute on function public.admin_product_funnel(integer) from public, anon;
revoke execute on function public.price_suggestion(text) from public, anon;
revoke execute on function public.worker_reputation_summary(uuid) from public, anon;
grant execute on function public.admin_attention_summary(), public.admin_business_metrics(), public.admin_product_funnel(integer), public.price_suggestion(text), public.worker_reputation_summary(uuid) to authenticated;
alter table public.tasks add constraint tasks_checkout_minimum check (pricing_rule_version=0 or offered_price=0 or offered_price>=10);
alter table public.task_offers add constraint task_offers_checkout_minimum check (amount>=10 and (counter_amount is null or counter_amount>=10));
