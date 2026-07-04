# Legacy Project Understanding Evolution Roadmap

## Goal

Evolve legacy-project bootstrap from a useful heuristic capability map into a
verified project-understanding layer that can support onboarding, task-time
context retrieval, human correction, and later hybrid RAG without making RAG the
only source of truth.

## Roadmap Scope

| Version | Scope | Outcome |
| --- | --- | --- |
| V1.1 | Calibration + noise reduction | Better route/framework coverage, lower noisy capability creation, clearer capability labels/confidence. |
| V1.2 | AST/symbol graph | Parser-backed symbols, imports/exports, and rough route -> handler -> service edges. |
| V1.3 | Task-time retrieval | ContextPack selects capability/symbol/test/hotspot evidence based on the task brief. |
| V1.4 | Visualization + human correction | UI shows capability map and lets users accept/rename/merge/mark wrong. Confirmed capabilities become governed knowledge candidates. |
| V2 | Hybrid retrieval/RAG | BM25/vector retrieval complements the evidence graph after graph contracts stabilize. |

## Current Increment

V1.1 calibration/noise reduction has shipped. V1.2 now has a first
parser-backed TypeScript/JavaScript evidence slice inside the existing read-only
inventory artifact. V1.3 parses current-run `project-inventory.json` into
task-time `code_probe` evidence. This increment now also includes first slices
of V1.4 and V2: project UI capability-map review/correction, deterministic
BM25-style hybrid retrieval over inventory records, and a default eval harness
scenario that measures capability-map selection and hybrid symbol-graph fallback
without external agent CLIs. A second default e2e eval fixture now writes a
temporary mini legacy project, runs the real scanner, then feeds the generated
`project-inventory.json` into the real ContextPack builder to guard the
scanner-to-context contract. The ContextPack builder can also reuse a governed
historical inventory knowledge artifact as `code_probe` evidence when the
current invocation has no `project-inventory.json` input. The runner now also
discovers the latest prior per-run inventory artifact and supplies it as
ContextPack `code_probe` evidence when no current or governed inventory source
is present. The default deterministic eval scenario now guards accepted rename
and merge correction paths influencing task-time ContextPack matching while
keeping correction artifacts out of normal `knowledge_*` rendering. The default
eval corpus now includes a Spring-style Java monolith
fixture that exercises route annotation -> handler method evidence and
task-focused ContextPack selection across billing, customer, and reports
domains. It also includes an ASP.NET-style C# monolith fixture that exercises
controller attribute routing, `[controller]` token expansion, action-method
handler evidence, and task-focused ContextPack selection across the same
multi-domain shape. It now also includes a WCF / .NET service-contract fixture
that exercises static `[ServiceContract(...)]` interfaces,
`[OperationContract(...)]` methods, unique implementation-class resolution,
explicit service/repository graph edges, and focused ContextPack selection
without leaking sibling WCF services through framework-layer vocabulary. A Go
monolith fixture now guards Gorilla mux/http route evidence, explicit
service/repository graph edges, and task-focused selection across the same
multi-domain shape. It now also includes an ASMX / .NET WebService fixture
that exercises static `[WebService(...)]` classes, `[WebMethod(...)]`
operations, explicit service/repository graph edges, and focused ContextPack
selection without leaking sibling ASMX services through framework-layer
vocabulary. A JAX-RS / Jakarta REST Java monolith
fixture now guards application-level `@ApplicationPath(...)`, class-level
`@Path(...)`, method-level HTTP/path annotation evidence, explicit
service/repository graph edges, and focused ContextPack selection without
leaking sibling `*Resource` domains through framework-layer vocabulary.
The default eval corpus now also includes a Java Servlet monolith fixture that
exercises static `@WebServlet(...)` url patterns and a separate old
deployment-descriptor fixture that exercises `web.xml` servlet-name /
servlet-class / url-pattern mappings. Both feed `doGet` / `doPost` handler
method evidence, explicit service/repository graph edges, and focused
ContextPack selection across the same multi-domain shape.
It now also includes a Struts-style Java monolith fixture that exercises static
Struts2 `struts.xml` package/action mappings, Struts1 `struts-config.xml`
action mappings, Action `execute` handler evidence, explicit
service/repository graph edges, and focused ContextPack selection without
leaking sibling `*Action` domains through framework-layer vocabulary.
It now also includes a JAX-WS / SOAP Java service fixture that exercises static
`@WebService(...)` class annotations and non-excluded `@WebMethod(...)`
operation annotations, emits `Class#method` handler evidence, links through
explicit service/repository graph edges, and keeps task-focused ContextPack
selection from leaking sibling SOAP services through framework vocabulary.
It now also includes a Spring XML MVC fixture that exercises static
`SimpleUrlHandlerMapping` URL maps, same-file bean id to controller class
resolution, static URL bean names, `Controller#handleRequest` handler
evidence, explicit service/repository graph edges, and focused ContextPack
selection without leaking sibling XML-mapped controllers or sibling
same-capability symbols through framework vocabulary.
It now also includes an ASP.NET Web Forms fixture that exercises static
`.aspx` Page directives, `Inherits="..."` code-behind class evidence,
`Page_Load` handler mapping, explicit service/repository graph edges, and
focused ContextPack selection without leaking unrelated page/code-behind/test
domains through Web Forms framework vocabulary.
It now also includes an old ASP.NET MVC/Web API route-table fixture that
exercises static `MapRoute(...)` and `MapHttpRoute(...)` calls with literal
route paths plus literal controller/action defaults, maps them to
`Controller#Action` graph evidence, and keeps focused ContextPack selection
from expanding broad conventional routes or leaking unrelated route-table
domains.
It now also includes a legacy JSP fixture that exercises static `.jsp` page
paths under `src/main/webapp`, treats them as page route evidence with bounded
source chunks, attaches billing tests, and keeps focused ContextPack selection
from leaking unrelated JSP page/test domains through generic page-rendering
vocabulary.
It now also includes a legacy CodeIgniter fixture that exercises static
`application/config/routes.php` route assignments, maps literal
`controller/method` targets to controller action graph evidence, follows
explicit PHP service/repository construction, and keeps focused ContextPack
selection from leaking unrelated CodeIgniter/PHP route domains through
framework/language vocabulary.
It now also includes a legacy CakePHP fixture that exercises static
`Router::connect(...)` route assignments, maps literal
`controller`/`action` array targets to controller action graph evidence,
follows explicit PHP service/repository construction, and keeps focused
ContextPack selection from leaking unrelated CakePHP/PHP route domains through
framework/language vocabulary.
It now also includes a legacy Yii/Yii2 fixture that exercises static
URL manager rules in PHP config files, maps literal `pattern` / `route`
and string-map rules to `Yii:<Controller>Controller@action<Action>` graph
evidence, follows explicit PHP service/repository construction, and keeps
focused ContextPack selection from leaking unrelated Yii/PHP route domains.
It now also includes a legacy Zend Framework 1 fixture that exercises static
`application.ini` router resources, maps literal route/controller/action
defaults to `Zend:<Controller>Controller@<action>Action` graph evidence,
follows explicit PHP service/repository construction, and keeps focused
ContextPack selection from leaking unrelated Zend/PHP route domains.
It now also includes a legacy Drupal 7 fixture that exercises static `.module`
`hook_menu()` definitions, maps literal menu paths and literal `page callback`
values to `Drupal:<callback>` function graph evidence, follows explicit PHP
service/repository construction, and keeps focused ContextPack selection from
leaking unrelated Drupal/PHP route domains.
It now also includes a separate legacy Drupal 7 `drupal_get_form` fixture that
maps literal form callbacks from the first literal `page arguments` entry to
`Drupal:<form_function>` graph evidence without exposing `drupal_get_form` as
the final handler.
It now also includes a legacy WordPress plugin fixture that exercises static
`add_action(...)` hooks for `admin_post_*` and `wp_ajax_*`, maps literal hook
callbacks to `WordPress:<callback>` function graph evidence, follows explicit
PHP service/repository construction, and keeps focused ContextPack selection
from leaking sibling AJAX/customer hooks.
It now also includes a legacy WordPress REST plugin fixture that exercises
static `register_rest_route(...)` calls, maps literal function callbacks to
`WordPress:<callback>` graph evidence, expands literal and
`WP_REST_Server::*` method evidence into concrete HTTP entrypoints, follows
explicit PHP service/repository construction, and keeps focused ContextPack
selection from leaking sibling customer REST routes or dynamic REST values.
It now also includes a legacy WordPress class-callback fixture that maps static
array callbacks such as `array(BillingRefundRestController::class,
'cancelRefund')` to `WordPress:<Class>@<method>` graph evidence, follows
explicit PHP service/repository construction, and keeps focused ContextPack
selection from leaking sibling customer routes or dynamic callback variables.
It now also includes a legacy Symfony YAML routing fixture that exercises
static `app/config/routing.yml` and `config/routes.yaml` route blocks with
literal `path` / `pattern` plus literal `_controller` / `controller` targets,
maps resolvable bundle/FQCN controller actions to graph evidence, follows
explicit PHP service/repository construction, and keeps focused ContextPack
selection from leaking sibling Symfony/YAML routes through framework/language
vocabulary.
It now also includes a legacy Symfony XML routing fixture that exercises
static `app/config/routing.xml` and `config/routes.xml` `<route>` elements
with literal `path` / `pattern` plus literal `_controller` / `controller`
default or attribute targets, maps resolvable bundle/FQCN controller actions
to graph evidence, follows explicit PHP service/repository construction, and
keeps focused ContextPack selection from leaking sibling Symfony/XML routes
through framework/language vocabulary.
It now also includes a legacy Sinatra Ruby fixture that exercises static
`get/post/... "/path" do` block routes in explicit Sinatra files, preserves
bounded route block source evidence for task-time ContextPack selection, and
keeps focused ContextPack selection from leaking sibling customer routes,
dynamic route expressions, wildcard routes, or raw inventory JSON. Inline
Sinatra blocks remain source evidence only; the scanner does not invent
route-handler graph edges for them.
It now also includes a Classic ASP fixture that exercises static `.asp` page
paths under a web root, treats them as source-ref backed page route evidence
with bounded source chunks, attaches billing tests, and keeps focused
ContextPack selection from leaking unrelated Classic ASP page/test domains
through ASP/VBScript/IIS framework vocabulary.
It now also includes a ColdFusion fixture that exercises static `.cfm` /
`.cfml` page paths under a web root, treats them as source-ref backed page
route evidence with bounded source chunks, attaches billing tests, and keeps
focused ContextPack selection from leaking unrelated ColdFusion/CFML page/test
domains through framework/language vocabulary.
It now also includes old Next Pages API route coverage for `pages/api/**`
files, including default-exported handler aliases, imported default handlers,
CommonJS default handlers, and thin route files that re-export a default
handler from another module. These routes now carry route -> handler -> service
graph evidence and scanner-to-ContextPack selection for task-focused Pages API
routes without leaking sibling domains.
Static `req.method` checks and `switch (req.method)` branches in Pages API
files now calibrate route methods from broad `ANY` to concrete HTTP methods
when the evidence is available.
Python star import expansion now honors simple static `__all__` declarations,
and PHP fully qualified constructed receivers such as
`new \App\Services\BillingService()` now resolve to scanned class paths before
service/repository graph edges are emitted. Single-line and multi-line PHP
grouped `use` imports also expand into canonical import evidence, so aliases
like `BillingRepo` keep graph edges pointed at the underlying repository class.
Flask/Python static `add_url_rule(...)` registrations such as
`app.add_url_rule(..., view_func=BillingRefundView.as_view(...), methods=["POST"])`
and `app.add_url_rule(..., view_func=approve_refund, methods=["POST"])`
now produce route handler evidence for the concrete HTTP method or function
view and continue through explicit service/repository graph edges. This
remains bounded to static URL strings, static MethodView class references,
simple static function handler names, and static method lists; dynamic
`view_func` values and runtime Flask route maps remain out of scope.
Rails/Ruby `require_dependency` statements now feed the same import-backed
receiver resolution path as local `require` / `require_relative` when the target
file is uniquely present under scanned Rails-style `app/` or `lib/` load paths.
This remains explicit dependency evidence, not broad Rails autoload inference.
Rails/Ruby qualified class declarations such as `class Billing::RefundService`
now emit the leaf class symbol (`RefundService`) instead of mislabeling the
namespace (`Billing`), so explicit namespaced receivers like
`Billing::RefundService.new` can continue through source-backed
service/repository method edges.
Rails/Ruby constructed receivers now also accept explicit global namespace
constants such as `::Billing::RefundService.new`, normalizing them to the same
leaf class symbol while keeping the dependency and call-site source refs.
Rails/Ruby explicit route targets with controller paths, such as
`to: "admin/billing#approve_refund"`, now preserve the literal controller path
as `admin/BillingController#approve_refund` and resolve it to
`app/controllers/admin/billing_controller.rb` action symbols. This remains
literal route-target evidence only; it does not infer controller namespaces from
Rails runtime autoloading or unrelated route scopes.
Rails legacy `match "/path", to: "...#...", via: ...` routes now produce
source-ref backed route entrypoints when the path, target, and `via` methods
are static. Static symbol, string, array, `%i[...]`, and `:all` method evidence
is supported under existing static scope prefixes; missing `via`, dynamic
paths, wildcard paths, constraints, block routes, and runtime Rails routing
remain out of scope.
Rails legacy hashrocket route targets such as
`get "/path" => "controller#action"` and
`match "/path" => "controller#action", via: :post` now feed the same literal
controller action handler evidence and route-handler graph chain. Hashrocket
matches without `via`, dynamic targets, redirects, implicit route targets, and
runtime Rails routing remain out of scope.
Rails static `root to: "...#..."` and `root "...#..."` routes now produce
source-ref backed `GET /` entrypoints, inheriting existing static scope prefixes
when present and mapping literal controller targets to the same route-handler
graph chain. Redirect roots, dynamic targets, block routes, and runtime Rails
routing remain out of scope.
Rails singular `resource :name` routes now produce source-ref backed RESTful
entrypoints without `:id` segments, honor static `only:` / `except:` action
filters, inherit existing static scope prefixes, and map to conventional
plural controller action evidence such as `AccountsController#update`.
Dynamic resource names and runtime Rails routing remain out of scope.
The default eval corpus now also includes a directory-backed Django commerce
fixture that exercises project URLConf `include(...)` mounts, billing/orders/
customers `urls.py` files, Python view/service/repository layers, SQL
schema/view/routine evidence, tests, source-RAG readiness gates, corpus
diversity gates, and sibling-domain leakage checks without executing Django or
database/runtime inspection.
The default eval corpus now also includes a directory-backed Laravel commerce
fixture that exercises static `Route::controller(...)->prefix(...)->group(...)`
controller route groups, billing/orders/customers PHP controller/service/
repository layers, SQL schema/view/routine evidence, tests, source-RAG
readiness gates, corpus diversity gates, and sibling-domain leakage checks
without executing Laravel, container bindings, route caches, or
database/runtime inspection.
The default eval corpus now also includes a directory-backed Spring commerce
fixture that exercises static annotation routes across billing/orders/customers
controllers, Java controller/service/repository layers, SQL schema/view/routine
evidence, tests, source-RAG readiness gates, corpus diversity gates, and
sibling-domain leakage checks without executing Spring, container bindings, or
database/runtime inspection.
The default eval corpus now also includes a directory-backed ASP.NET commerce
fixture that exercises static attribute routes across billing/orders/customers
controllers, C# controller/service/repository layers, SQL schema/view/routine
evidence, tests, source-RAG readiness gates, corpus diversity gates, and
sibling-domain leakage checks without executing ASP.NET, DI/container wiring,
IIS routing, or database/runtime inspection.
The default eval corpus now also includes a directory-backed Go commerce
fixture that exercises static mux/http routes across billing/orders/customers
handlers, Go handler/service/repository layers, SQL schema/view/routine
evidence, tests, source-RAG readiness gates, corpus diversity gates, and
sibling-domain leakage checks without executing Go binaries, HTTP servers, or
database/runtime inspection.
The default eval corpus now also includes a directory-backed Struts commerce
fixture that exercises static Struts2 `struts.xml` package/action mappings and
Struts1 `struts-config.xml` action mappings across billing/orders/customers,
Java action/service/repository layers, SQL schema/view/routine evidence, tests,
source-RAG readiness gates, corpus diversity gates, and sibling-domain leakage
checks without executing Struts, servlet containers, DI/container wiring, or
database/runtime inspection.
The default eval corpus now also includes a directory-backed JAX-RS commerce
fixture that exercises static `@ApplicationPath`, resource class `@Path`, and
method-level HTTP/path annotations across billing/orders/customers, Java
resource/service/repository layers, SQL schema/view/routine evidence, tests,
source-RAG readiness gates, corpus diversity gates, and sibling-domain leakage
checks without executing JAX-RS runtimes, servlet containers, DI/container
wiring, or database/runtime inspection.
The default eval corpus now also includes a directory-backed WCF commerce
fixture that exercises static `.svc` `ServiceHost` directives,
`ServiceContract` / `OperationContract` service operations across
billing/orders/customers, C# implementation/manager/repository layers, SQL
schema/view/routine evidence, tests, source chunk hash/index readiness gates,
corpus diversity gates, and sibling-domain leakage checks without executing WCF
hosts, endpoint config, bindings, IIS, DI/container wiring, or database/runtime
inspection.
The default eval corpus now also includes a directory-backed JAX-WS commerce
fixture that exercises static `@WebService` classes and `@WebMethod`
operations across billing/orders/customers, Java service/manager/repository
layers, SQL schema/view/routine evidence, tests, source chunk hash/index
readiness gates, corpus diversity gates, and sibling-domain leakage checks
without executing SOAP endpoints, WSDL descriptors, servlet containers,
DI/container wiring, or database/runtime inspection.
The default eval corpus now also includes a directory-backed ASMX commerce
fixture that exercises old `.asmx` host files plus static `[WebService]`
classes and `[WebMethod]` operations across billing/orders/customers, C#
service/manager/repository layers, SQL schema/view/routine evidence, tests,
source chunk hash/index readiness gates, corpus diversity gates, and
sibling-domain leakage checks without executing ASP.NET, IIS, SOAP endpoints,
WSDL descriptors, DI/container wiring, or database/runtime inspection.
The default eval corpus now also includes a directory-backed ASP.NET Web Forms
commerce fixture that exercises old `.aspx` Page directives, `Inherits`
code-behind classes, `Page_Load` handler mapping, C# page/service/repository
layers, SQL schema/view/routine evidence, tests, source chunk hash/index
readiness gates, corpus diversity gates, and sibling-domain leakage checks
without executing ASP.NET, IIS, Web.config routing, page lifecycle events beyond
the static handler evidence, DI/container wiring, or database/runtime
inspection.
The default eval corpus now also includes a directory-backed CakePHP commerce
fixture that exercises static `Router::connect(...)` routes across billing,
orders, and customers; PHP controller/service/repository layers; SQL
schema/view/routine evidence; tests; source chunk hash/index readiness gates;
corpus diversity gates; and sibling-domain leakage checks without executing
CakePHP, plugin routes, DI/container wiring, or database/runtime inspection.
The default eval corpus now also includes a directory-backed Yii/Yii2 commerce
fixture that exercises static URL manager rules across billing, orders, and
customers; PHP controller/service/repository layers; SQL schema/view/routine
evidence; tests; source chunk hash/index readiness gates; corpus diversity
gates; and sibling-domain leakage checks without executing Yii modules,
callbacks, URL manager runtime behavior, DI/container wiring, or
database/runtime inspection.
The default eval corpus now also includes a directory-backed Zend Framework 1
commerce fixture that exercises static `application.ini` router resources
across billing, orders, and customers; PHP controller/service/repository
layers; SQL schema/view/routine evidence; tests; source chunk hash/index
readiness gates; corpus diversity gates; and sibling-domain leakage checks
without executing Zend front-controller dispatch, modules/plugins beyond
literal route evidence, DI/container wiring, or database/runtime inspection.
Laravel/PHP service-locator assignments with static class literals, such as
`app(\App\Services\BillingService::class)` and
`\App::make(BillingRepo::class)`, now feed the same source-backed receiver
chain without inferring string service names or runtime container bindings.
Laravel/PHP static controller groups such as
`Route::controller(BillingController::class)->prefix(...)->group(...)` now let
nested string actions like `Route::post(..., "approveRefund")` resolve to
`BillingController@approveRefund`, preserving group and route source refs and
continuing through existing controller -> service/repository graph evidence.
This remains bounded to static controller class literals and quoted action
names; dynamic controller groups and runtime route inspection remain out of
scope.
Laravel/PHP static factory assignments with explicit class receivers, such as
`\App\Services\BillingService::make()` and `BillingRepo::instance()`, now also
feed that receiver chain for a small allowlist of factory-like method names.
The scanner keeps this conservative by excluding the Laravel `App` facade path
from factory inference, so `\App::make(...)` remains service-locator evidence
instead of being treated as an `App` receiver.
The ContextPack hybrid fallback now also searches symbol-graph edge labels as
first-class inventory records, so a task can recover call-site evidence and
graph-pointed source chunks even when no capability, symbol, test, or hotspot
record directly carries the task terms.
The legacy eval harness now also supports scenario-level inventory quality
gates over scanner-real outputs, including measured variant counts, symbol
graph edge confidence floors, and route-handler edge confidence floors. The
default Play, Slim/Silex, and polyglot scanner-to-ContextPack fixtures exercise
those gates so future fixture expansion cannot silently omit graph quality
coverage.
It now also measures scanner-real corpus-readiness diversity through
scenario-level source extension, source path-pattern, and inventory record-kind
floors, so fixture expansion has a deterministic proxy before claiming progress
toward broader real legacy-project corpus evaluation.
Graph-bearing legacy fixtures now also receive conservative default graph
quality floors when no explicit `inventoryQualityGates` are declared, so
omitting a custom gate no longer removes baseline confidence coverage.
ContextPack eval selected-section gates now also check section-local content
and reason text. The mark-wrong correction fixture uses this to prove
suppressed capability and hybrid fallback sections retain explicit
source-level fallback rationale plus accepted correction review text.
The hybrid fallback source-chunk path now deduplicates graph/inventory pointers
before rendering, and source chunk sections include the real pointing evidence
record such as the `symbol_reference` graph edge instead of repeating the same
edge id.
The deterministic correction eval now also proves review-required rename,
merge, and mark-wrong corrections do not affect inventory matching, corrected
label matching, suppression, or selected section source refs until governance
accepts them without a review-required status.
The ContextPack builder now emits a stale review signal when an accepted,
non-review-required capability correction points to a capability that no longer
exists in the current-run inventory, giving the correction loop a first drift
signal without applying the correction to unrelated records.
This also covers a valid fresh inventory whose capability list is empty, so an
empty scan cannot silently hide previously accepted capability corrections.
It now emits a superseded review signal instead when the current scan already
contains a capability whose display label matches the accepted rename
corrected label or merge target, making scan convergence visible without
attaching the old correction to the new capability.
If that governed label matches multiple current capability display labels,
ContextPack emits a `conflict` / review-required ambiguity signal instead of
choosing one current capability as superseded. The signal cites the correction,
missing old capability id, every matching current capability/source ref, the
current inventory artifact, and the original correction evidence while keeping
old correction refs out of selected current capability sections.
Eval coverage now checks the drift signal structurally, including kind,
severity, recommended action, message text, correction/capability subject refs,
and current/original inventory evidence refs.
Broad cross-run source RAG, a managed vector index, durable correction
feedback, and broader real legacy-project eval corpora remain follow-up work.
The current vector slice can use an injected source-chunk embedding provider
when it returns valid compatible vectors, but the default remains the local
deterministic provider with no network access or new dependency.
The current source-reuse increment adds a bounded `sourceChunkIndex` manifest
inside `project-inventory.json`, keyed by source chunk `contentSha256`,
path/window, source refs, and linked inventory record refs. ContextPack may
consume that manifest from current-run or accepted historical inventory JSON to
recover missing source-chunk link refs before selecting bounded `code_probe`
evidence, but the index remains metadata-only and never replaces source refs or
bounded snippets as evidence.
ContextPack hybrid retrieval now also accepts exact task source refs as a
bounded supplement even when a capability match is already selected, so
line-cited graph evidence and its pointed source chunks can join the pack
without demoting capability-map evidence or matching unrelated same-file
records/source chunks by path text alone.
The default deterministic eval scenario now measures this path with an
exact-line graph supplement variant plus a path-only negative variant that
includes same-file hybrid and source-chunk exclusions.
Lexical source chunk retrieval now scores task-term snippet matches with the
same BM25-style helper used by hybrid inventory retrieval and renders a
`BM25 score` audit line while keeping capability-map and symbol-graph evidence
primary.
The legacy eval harness can now source scanner-to-context fixture files from a
checked-in `fixtureDir` under the repository in addition to inline `files[]`.
Fixture directories resolve relative to the scenario JSON file, are rejected if
they escape the repository root, are read recursively as sorted regular files
under explicit file count and byte bounds, and merge with inline files before
the real `buildProjectInventory()` -> `buildContextPack()` path runs.

## Requirements

### V1.1 - Calibration + Noise Reduction

- Expand route detection for common frameworks and conventions:
  - Express/Hono/Fastify-like `app.get(...)`, `router.post(...)`,
    `fastify.route({ method, url })`
  - Fastify same-file static `register(plugin, { prefix: "..." })` plugin
    routes, when the registered plugin function and route declarations are
    both static evidence in the same scanned file.
  - Flask/FastAPI `@app.route(...)`, `@app.get(...)`
  - Next.js App Router `app/api/**/route.ts`
  - Next.js Pages API `pages/api/**` files with static default exports and
    default-handler re-exports, imported default handlers, CommonJS
    `module.exports` handlers, plus static `req.method` branch calibration
    when present.
  - Rails legacy `match "/path", to: "...#...", via: ...` routes when the
    path, controller target, and `via` method evidence are static.
  - Rails legacy hashrocket route targets such as
    `get "/path" => "controller#action"` and hashrocket `match` routes with
    static `via` method evidence.
  - Rails static `root to: "...#..."` and `root "...#..."` routes when the
    controller target is literal evidence, including existing static scope
    prefixes.
  - Rails singular `resource :name` routes when the resource name and
    `only:` / `except:` action filters are static evidence.
  - Go router patterns such as `router.GET(...)` and `http.HandleFunc(...)`
  - Rails-style `get "/path", to: ...`
  - Laravel/PHP `Route::get(...)`, Django `path(...)` / `re_path(...)`, and
    ASP.NET controller attributes such as `[Route]` / `[HttpGet]`
  - CodeIgniter 2/3 static route config entries such as
    `$route['billing/statements'] = 'billing/statements'` in
    `application/config/routes.php`, when both route path and
    `controller/method` target are literal evidence.
  - CakePHP 2/3 static route config entries such as
    `Router::connect('/billing/statements', array('controller' => 'billing',
    'action' => 'statements'))` in `app/Config/routes.php` or
    `config/routes.php`, when route path, controller, and action are all
    literal evidence.
  - Yii/Yii2 static URL manager rules in common PHP config paths such as
    `config/web.php`, `config/main.php`, `frontend/config/main.php`,
    `backend/config/main.php`, and `protected/config/main.php`, when
    string-map rules or array-style `pattern` / `route` values are literal
    evidence.
  - Zend Framework 1 static `application.ini` router resources such as
    `resources.router.routes.billing.route = "/billing/statements"` plus
    literal `defaults.controller` / `defaults.action` values.
  - Drupal 7 static `.module` `hook_menu()` definitions such as
    `$items['billing/refunds/%/approve'] = array(...)`, when the menu path and
    `page callback` function are literal evidence, or when literal
    `drupal_get_form` callbacks provide a first literal `page arguments` form
    function.
  - WordPress static plugin hooks such as
    `add_action('admin_post_billing_refund_approve', 'billing_refund_approve')`
    or `add_action('wp_ajax_billing_refund_status', 'billing_refund_status')`,
    when the hook name and callback function or static class callback are both
    literal evidence.
  - WordPress static REST routes such as
    `register_rest_route('billing/v1', '/refunds/(?P<id>\d+)/approve', ...)`,
    when namespace, route path, callback function or static class callback,
    and methods are static literal or known `WP_REST_Server::*` constant
    evidence.
  - Slim/Silex-style PHP route calls such as
    `$app->post('/billing/refunds/{id}/approve',
    [BillingController::class, 'approveRefund'])` or
    `$app->get('/customers/{id}', 'CustomerController:profile')`, when the
    receiver and controller callable are static evidence.
  - Sinatra-style Ruby block routes such as
    `post "/billing/refunds/:refund_id/cancel" do ... end`, when the file
    has explicit Sinatra evidence and the route path is static. These produce
    bounded source-ref backed route evidence but no fake handler symbol for
    inline blocks.
  - Legacy Symfony YAML route files such as `app/config/routing.yml` or
    `config/routes.yaml`, when a simple static route block contains a literal
    `path` / `pattern` and literal `_controller` / `controller` target such as
    `AcmeBillingBundle:Statement:show` or
    `AppBundle\\Controller\\StatementController::showAction`.
  - Legacy Symfony XML route files such as `app/config/routing.xml` or
    `config/routes.xml`, when a static `<route>` element contains a literal
    `path` / `pattern` and literal `_controller` / `controller` default or
    attribute target such as `AcmeBillingBundle:Statement:show` or
    `AppBundle\\Controller\\StatementController::showAction`.
  - WCF / .NET service contracts such as `[ServiceContract(...)]` plus
    `[OperationContract(...)]` in old C# service projects.
  - ASMX / .NET WebService classes such as `[WebService(...)]` plus
    `[WebMethod(...)]` in older C# SOAP service projects.
  - ASP.NET Web Forms pages such as static `.aspx` Page directives with
    `Inherits="..."` code-behind classes, deriving the route from the page path
    and mapping conservatively to `Page_Load`.
  - Old ASP.NET MVC/Web API route tables such as `routes.MapRoute(...)` or
    `config.Routes.MapHttpRoute(...)` when `url` / `routeTemplate` and
    `controller`/`action` defaults are all static string evidence.
  - Spring/Nest-style decorator/annotation mappings already partly supported,
    but should be less brittle around method/route parsing.
  - Spring XML MVC mappings such as
    `SimpleUrlHandlerMapping` plus `<prop key="/...">beanId</prop>` or
    `<entry key="/..." value-ref="beanId" />`, and URL bean names such as
    `<bean name="/path.htm" class="...Controller" />`, in older Spring MVC
    projects.
  - Play Framework route files such as `conf/routes`, when a static HTTP
    method/path line targets a Java controller method like
    `controllers.BillingController.approveRefund(...)`.
  - JAX-RS / Jakarta REST static annotations such as class-level `@Path(...)`
    plus method-level `@GET` / `@POST` and `@Path(...)` in old Java services.
  - JAX-WS / SOAP static annotations such as class-level `@WebService(...)`
    plus non-excluded method-level `@WebMethod(...)` operations in old Java
    SOAP services.
  - Java Servlet static annotations such as `@WebServlet(...)` with single or
    multiple `urlPatterns`, mapped to `doGet` / `doPost` style handler methods.
  - Java Servlet deployment descriptors such as `WEB-INF/web.xml` with static
    servlet-name / servlet-class / url-pattern mappings.
  - Legacy JSP pages from static `.jsp` file paths under web roots such as
    `src/main/webapp`, deriving page route entrypoints without inferring JSP
    runtime, tag libraries, includes, or form actions.
  - Classic ASP pages from static `.asp` file paths under web roots such as
    `web`, deriving page route entrypoints without inferring server-side
    includes, form actions, COM objects, ADO calls, IIS mappings, or runtime
    page dispatch behavior.
  - ColdFusion pages from static `.cfm` / `.cfml` file paths under web roots
    such as `wwwroot`, deriving page route entrypoints without inferring
    `cfinclude`, `cfform`, CFC components, datasources, application mappings,
    scheduled tasks, or runtime page dispatch behavior.
  - Struts static XML action mappings such as Struts2 `struts.xml`
    `<package namespace=...><action name=... class=... method=...>` and
    Struts1 `struts-config.xml` `<action path=... type=...>`.
- Reduce noisy CLI capabilities:
  - Keep all package scripts in `commands`.
  - Create CLI entrypoints only for scripts likely to expose runtime/operator
    capabilities (`start`, `dev`, `serve`, `worker`, `migrate`, `seed`,
    `import`, `export`, etc.).
  - Do not turn `test`, `typecheck`, `lint`, `format`, or `build` scripts into
    core capabilities.
- Reduce noisy job/queue detection:
  - Do not create job/queue entrypoints from a path name alone on every symbol
    line.
  - Require line-level evidence such as `queue.process`, `cron.schedule`,
    `@Scheduled`, `schedule(...)`, or one file-level path hint.
- Improve capability grouping and labels:
  - Ignore generic route prefixes such as `api`, `v1`, `v2`.
  - Group `/api/users/:id` under `Users API`, not `Api API`.
  - Keep confidence conservative when only path/name hints exist.
- Preserve existing safety boundaries:
  - no new dependency,
  - read-only scan,
  - existing sensitive/generated/binary/size filters apply before extraction.

### V1.2 - AST / Symbol Graph

- V1.2: introduce parser-backed extraction. The first slice uses the existing
  TypeScript compiler API when available, without making it a hard runner
  runtime dependency; future slices can evaluate ast-grep/tree-sitter or
  language-specific parsers for non-TS projects.

### V1.3 - Task-Time Retrieval

- V1.3: connect `ContextPack` retriever to capability/symbol/test/hotspot
  sections. The first slice parses current-run `project-inventory.json` input
  artifacts and selects task-relevant inventory evidence as `code_probe`
  ContextPack sections.
- V1.3 should also accept governed historical inventory knowledge artifacts as
  inventory sources when they carry `ainp.project_inventory.v1` content, while
  still excluding the raw JSON from normal knowledge-context rendering.

### V1.4 - Visualization + Human Correction

- The project page should render a compact capability map from the latest
  profile-bootstrap `project-inventory.json` artifact when the matching run
  detail is loaded.
- Each capability row should expose entrypoint/symbol/test/hotspot evidence
  with confidence and source-derived paths.
- Users can accept, rename, merge, or mark a capability wrong from the project
  page.
- Corrections are persisted as draft project-scoped knowledge artifacts with
  `metadata.correctionKind='project_capability_map'`, `reviewStatus='needs_review'`,
  and source refs to the inventory artifact plus underlying code/test evidence.
  They must not become accepted authoritative knowledge without the existing
  knowledge governance flow.
- Accepted, non-review-required correction artifacts may influence later
  task-time ContextPack matching, but only by extending or suppressing
  inventory-backed `code_probe` evidence. The correction artifact should appear
  as a source ref, not as a standalone `knowledge_*` section.

### V2 - Hybrid Retrieval / RAG First Slice

- The ContextPack builder should keep capability-map matching as the primary
  deterministic graph lookup.
- When no matched capability owns relevant evidence, the builder may run a
  deterministic BM25-style lexical search over inventory entrypoints, symbols,
  tests, hotspots, and symbol graph edges.
- Hybrid retrieval output must still be `code_probe` evidence with source refs
  to the inventory artifact and underlying files. It must not inject the full
  inventory JSON as ordinary input context.
- Source chunks selected through hybrid or graph pointers must deduplicate
  pointing records and render the real pointing evidence in the selected
  section, so the agent sees which inventory edge led to the bounded snippet.
- Historical inventory knowledge artifacts may feed the same capability/BM25
  path as current-run inventory when their metadata embeds
  `ainp.project_inventory.v1` JSON. The selected sections must cite both
  `knowledge_artifact:*` and the original inventory/source refs.
- Default eval scenarios should include a deterministic legacy-project
  understanding fixture that proves capability-map matches stay primary and
  BM25 fallback can recover symbol/test evidence with graph/source refs when no
  capability directly matches.
- Scanner-to-context eval coverage should include a temporary real fixture
  project so route/capability/symbol extraction regressions are caught before
  ContextPack assertions run.
- Capability matching must not use encoded inventory ids, same-file paths, test
  paths, hotspot paths, or raw source refs as primary capability match text.
  Otherwise unrelated capabilities in the same route file can be selected for
  the task.
- Managed vector-index retrieval and broad cross-run source lookup remain
  later V2 work after graph contracts and evaluation data stabilize. In this
  increment, cross-task reuse covers current-run inventory, governed inventory
  knowledge, and the latest prior per-run inventory artifact discovered by the
  runner. Optional injected source-chunk embedding providers may supply
  bounded vectors for index rows and task-time catalog `q` queries, but invalid
  or failed providers fall back to local deterministic vectors. Catalog vector
  queries carry the embedding model when known, so vector scoring uses only
  same-model/same-dimension rows while lexical matches remain available. Exact
  linked-record catalog fallback remains ref-only.
- Project inventory includes a bounded source chunk index/manifest that can be
  reused across current and historical inventory evidence without adding
  external embedding/vector dependencies.

## Acceptance Criteria

- [ ] V1.1 route fixtures detect Express/Hono/Fastify, Flask/FastAPI, Next App
      Router, Go router, Rails-style, Spring/Nest-style, Spring XML MVC,
      Laravel/PHP, Django, ASP.NET, WCF, ASMX, JAX-RS, Servlet, and Struts
      routes.
- [ ] `test`, `typecheck`, `lint`, `format`, and `build` package scripts remain
      commands but do not create capability entrypoints.
- [ ] Runtime/operator scripts such as `start`, `dev`, `migrate`, `seed`,
      `import`, and `export` can create CLI entrypoints.
- [ ] Job/queue entrypoints are not duplicated for every line in a worker-like
      file.
- [ ] Route capability labels skip generic prefixes and group meaningful
      segments.
- [ ] Existing profile bootstrap tests still pass.
- [ ] `bun run typecheck` and relevant runner tests pass.
- [ ] V1.2 inventory output includes additive `imports`, `exports`, and
      `symbolGraph` fields.
- [ ] TS/JS parser-backed extraction identifies imports, exported declarations,
      methods, and handler/service references without relying on regex lines
      for those files.
- [ ] `symbolGraph.edges` links HTTP route entrypoints to handler symbols when
      the handler is resolvable.
- [ ] `symbolGraph.edges` records rough handler-to-service symbol references
      when AST evidence shows construction or calls.
- [ ] V1.3 ContextPack builder parses `project-inventory.json` input artifacts
      and derives `code_probe` candidates from capabilities, symbols, tests,
      and hotspots.
- [ ] Task brief matching selects meaningful business tokens, not generic
      tokens such as `api` or `test`.
- [ ] Matched inventory evidence appears in ContextPack sections and manifest
      with source refs to the inventory artifact and underlying files.
- [ ] Historical inventory knowledge artifacts can produce the same
      `code_probe` capability/symbol/test/hotspot sections without rendering
      raw inventory JSON as `knowledge_*` context.
- [ ] Unmatched capabilities are not injected solely because they share generic
      framework/API vocabulary.
- [ ] Project UI renders latest inventory capabilities with entrypoint,
      symbol, test, hotspot, confidence, and source-path evidence.
- [ ] Project UI exposes accept, rename, merge, and mark-wrong actions for
      inventory capabilities.
- [ ] Accepted/renamed/merged/wrong capability actions create draft governed
      knowledge candidates, not accepted knowledge.
- [ ] Draft capability correction metadata records action, original/corrected
      labels or merge target, inventory artifact id, review-required status,
      and source refs to inventory plus underlying evidence.
- [ ] Accepted, non-review-required capability rename and merge corrections
      can select the corrected or merged inventory capability for matching task
      briefs without rendering the correction artifact as a standalone
      `knowledge_*` section.
- [ ] Review-required capability rename and merge corrections do not match
      their corrected label or merge target until governance accepts them
      without a review-required status.
- [ ] Accepted capability corrections whose `capabilityId` disappears from the
      current inventory emit a stale calibration/review signal instead of being
      silently ignored or applied to unrelated capabilities.
- [ ] Valid fresh inventories with no capabilities still emit stale
      calibration/review signals for accepted corrections whose old
      `capabilityId` is absent.
- [ ] Accepted rename/merge corrections whose old `capabilityId` disappears,
      but whose corrected label or merge target now matches a current
      capability display label, emit a superseded calibration/review signal
      and do not attach the old correction to the current capability evidence.
- [ ] Accepted rename/merge corrections whose old `capabilityId` disappears
      and whose corrected label or merge target matches more than one current
      capability display label emit a conflict calibration/review signal
      citing every matching current capability/source ref, and do not attach
      the old correction artifact/source refs/review text to selected current
      capability sections.
- [ ] Correction drift evals assert the review signal's kind/severity/action
      plus subject and evidence refs, not only that a signal exists.
- [ ] ContextPack builder performs deterministic BM25-style fallback retrieval
      over inventory records, including symbol graph edge labels, when
      capability matching alone would miss relevant symbol/test/hotspot/call-site
      evidence.
- [ ] Hybrid fallback source chunks deduplicate repeated graph pointers and
      render real pointing evidence details, with section-local eval coverage
      for content and reason text.
- [ ] Hybrid inventory retrieval remains source-ref backed `code_probe`
      evidence and does not inject raw `project-inventory.json` as a normal
      input artifact.
- [ ] Default eval harness includes a legacy-project understanding scenario
      that checks primary capability-map selection, unrelated capability
      exclusion, raw inventory exclusion, and hybrid symbol-graph fallback with
      scanner-real `node_symbol_*` source refs.
- [ ] Default eval harness includes a scanner-to-context legacy fixture that
      creates a temporary project, runs real `buildProjectInventory()`, runs
      real `buildContextPack()`, verifies sensitive-file exclusions, and proves
      same-file unrelated capabilities are not selected.
- [ ] Legacy scanner-to-context fixtures may use a bounded checked-in
      `fixtureDir` as their source corpus, merged with inline `files[]`, while
      rejecting paths that escape the repository root or exceed declared file
      count/byte limits.
- [ ] Default eval harness includes a Spring-style legacy Java fixture that
      proves class-level `@RequestMapping` prefixes and method-level mapping
      annotations produce route-handler evidence without selecting unrelated
      controller capabilities through framework/layer vocabulary alone.
- [ ] Default eval harness includes a Spring XML MVC legacy Java fixture that
      proves static `SimpleUrlHandlerMapping` URL maps resolve same-file bean
      ids to `Controller#handleRequest` route-handler evidence and explicit
      service/repository graph evidence, and proves static URL bean names
      produce the same route-handler evidence without selecting unrelated
      XML-mapped controllers or sibling same-capability symbols through generic
      framework/layer vocabulary.
- [ ] Default eval harness includes an ASP.NET-style legacy C# fixture that
      proves controller route attributes, `[controller]` token expansion, and
      action method route-handler evidence feed focused ContextPack selection
      without leaking unrelated controller/test domains.
- [ ] Default eval harness includes a WCF / .NET legacy fixture that proves
      static `[ServiceContract(...)]` plus `[OperationContract(...)]`
      operations produce route-handler and service/repository graph evidence
      without selecting unrelated WCF service capabilities through generic
      framework/layer vocabulary.
- [ ] Default eval harness includes an ASMX / .NET legacy fixture that proves
      static `[WebService(...)]` plus `[WebMethod(...)]` operations produce
      route-handler and service/repository graph evidence without selecting
      unrelated ASMX service capabilities through generic framework/layer
      vocabulary.
- [ ] Default eval harness includes an ASP.NET Web Forms legacy fixture that
      proves static `.aspx` Page directives plus `Inherits="..."`
      code-behind classes produce page route, `Page_Load`, and explicit
      service/repository graph evidence without selecting unrelated page,
      code-behind, or test domains through Web Forms framework/layer
      vocabulary.
- [ ] Default eval harness includes an old ASP.NET MVC/Web API route-table
      fixture that proves static `MapRoute(...)` / `MapHttpRoute(...)` calls
      with literal route path and controller/action defaults produce
      `Controller#Action` route-handler and service/repository graph evidence
      without expanding broad `{controller}/{action}` conventional routes or
      selecting unrelated route-table domains through framework/layer
      vocabulary.
- [ ] Default eval harness includes a Go legacy fixture that proves
      `HandleFunc(...).Methods(...)` / `http.HandleFunc(...)` route evidence and
      explicit service/repository graph edges feed focused ContextPack
      selection without leaking unrelated handler/test domains.
- [ ] Default eval harness includes a JAX-RS / Jakarta REST legacy Java fixture
      that proves application-level `@ApplicationPath(...)`, class-level
      `@Path(...)`, and method-level HTTP/path annotations produce
      route-handler evidence without selecting unrelated `*Resource`
      capabilities through generic framework/layer vocabulary.
- [ ] Default eval harness includes a JAX-WS / SOAP legacy Java fixture that
      proves static `@WebService(...)` plus non-excluded `@WebMethod(...)`
      operations produce route-handler and service/repository graph evidence
      without selecting unrelated SOAP service capabilities through generic
      framework/layer vocabulary.
- [ ] Default eval harness includes a Java Servlet legacy fixture that proves
      static `@WebServlet(...)` single and multiple url patterns plus
      `doGet` / `doPost` handlers produce route-handler evidence without
      selecting unrelated servlet/test domains through framework/layer
      vocabulary.
- [ ] Default eval harness includes a Java `web.xml` Servlet legacy fixture
      that proves static deployment-descriptor servlet mappings produce
      route-handler evidence without selecting unrelated servlet/test domains
      through framework/layer vocabulary.
- [ ] Default eval harness includes a legacy JSP fixture that proves static
      `.jsp` file paths under `src/main/webapp` produce page route and bounded
      source chunk evidence without selecting unrelated page/test domains
      through generic JSP/page/rendering vocabulary.
- [ ] Default eval harness includes a legacy CodeIgniter fixture that proves
      static `application/config/routes.php` route assignments produce route ->
      controller action -> explicit service/repository evidence without
      expanding dynamic route patterns or selecting unrelated PHP route/test
      domains through framework/language vocabulary.
- [ ] Default eval harness includes a legacy CakePHP fixture that proves static
      `Router::connect(...)` route assignments produce route -> controller
      action -> explicit service/repository evidence without expanding dynamic
      route patterns or selecting unrelated PHP route/test domains through
      framework/language vocabulary.
- [ ] Default eval harness includes a legacy Yii/Yii2 fixture that proves
      static URL manager string-map and array-style rules produce route ->
      controller action -> explicit service/repository evidence without
      selecting unrelated PHP route/test domains through framework/language
      vocabulary.
- [ ] Default eval harness includes a legacy Zend Framework 1 fixture that
      proves static `application.ini` router resources produce route ->
      controller action -> explicit service/repository evidence without
      selecting unrelated PHP route/test domains through framework/language
      vocabulary.
- [ ] Default eval harness includes a legacy Drupal 7 fixture that proves
      static `.module` `hook_menu()` definitions produce route -> page
      callback function -> explicit service/repository evidence without
      selecting unrelated PHP route/test domains through framework/language
      vocabulary.
- [ ] Default eval harness includes a legacy Drupal 7 `drupal_get_form`
      fixture that proves static form menu items produce route -> form
      function -> explicit service/repository evidence without selecting
      unrelated PHP form route/test domains or dynamic form ids.
- [ ] Default eval harness includes a legacy WordPress plugin fixture that
      proves static `admin_post_*` / `wp_ajax_*` hooks produce route ->
      callback function -> explicit service/repository evidence without
      selecting sibling AJAX/customer hooks or dynamic hook/callback values.
- [ ] Default eval harness includes a legacy WordPress REST plugin fixture that
      proves static `register_rest_route(...)` calls produce REST route ->
      callback function -> explicit service/repository evidence without
      selecting sibling customer REST routes or dynamic REST values.
- [ ] Default eval harness includes a legacy WordPress class-callback fixture
      that proves static array callbacks produce route -> class method ->
      explicit service/repository evidence without selecting sibling customer
      routes or dynamic callback variables.
- [ ] Default eval harness includes a legacy Symfony YAML fixture that proves
      static route blocks produce route -> controller action -> explicit
      service/repository evidence without expanding placeholders, imports,
      service-container routes, annotations, bundle imports, or selecting
      unrelated Symfony/YAML route/test domains through framework/language
      vocabulary.
- [ ] Default eval harness includes a legacy Symfony XML fixture that proves
      static `<route>` elements produce route -> controller action -> explicit
      service/repository evidence without expanding placeholders, imports,
      service-container routes, annotations, bundle imports, callbacks, or
      selecting unrelated Symfony/XML route/test domains through
      framework/language vocabulary.
- [ ] Default eval harness includes a legacy Slim/Silex fixture that proves
      static `$app` / `$router` route calls produce route ->
      `Slim:Controller@action` -> explicit service/repository evidence without
      selecting unrelated PHP route/test domains, arbitrary non-route receiver
      calls, or closure-only handlers.
- [ ] Default eval harness includes a legacy Sinatra fixture that proves
      static block routes produce bounded source-ref backed route/source chunk
      evidence and attached tests without selecting sibling customer routes,
      dynamic route expressions, wildcard routes, or raw inventory JSON.
- [ ] Default eval harness includes a legacy Rails `match ... via:` fixture
      that proves static legacy `match` routes produce route -> controller
      action -> explicit service/repository evidence without selecting sibling
      customer routes, no-`via` routes, dynamic route expressions, wildcard
      routes, or raw inventory JSON.
- [ ] Default eval harness includes a legacy Rails hashrocket fixture that
      proves static `get "..."=> "...#..."` and hashrocket `match` routes with
      `via` produce route -> controller action -> explicit service/repository
      evidence without selecting sibling customer routes, no-`via` hashrocket
      matches, or raw inventory JSON.
- [ ] Default eval harness includes a legacy Rails `root` fixture that proves
      static `root to: "...#..."` and `root "...#..."` routes produce scoped
      `GET /` route -> controller action -> explicit service/repository
      evidence without selecting sibling customer roots, redirect roots,
      dynamic root targets, or raw inventory JSON.
- [ ] Default eval harness includes a legacy Rails singular `resource` fixture
      that proves static `resource :name` routes produce no-id RESTful route ->
      plural controller action -> explicit service/repository evidence without
      selecting sibling customer resources, dynamic resource targets, or raw
      inventory JSON.
- [ ] Default eval harness includes a Play Framework fixture that proves static
      `conf/routes` entries produce route -> Java controller method ->
      explicit service/repository evidence without selecting unrelated
      Play/Java route/test domains through framework/layer vocabulary.
- [ ] Default eval harness includes a Classic ASP fixture that proves static
      `.asp` file paths under a web root produce page route and bounded source
      chunk evidence without selecting unrelated page/test domains through
      generic ASP/VBScript/IIS vocabulary.
- [ ] Default eval harness includes a ColdFusion fixture that proves static
      `.cfm` / `.cfml` file paths under a web root produce page route and
      bounded source chunk evidence without selecting unrelated page/test
      domains through generic ColdFusion/CFML vocabulary.
- [ ] Default eval harness includes a Struts legacy Java fixture that proves
      static Struts2 and Struts1 XML action mappings produce route -> Action
      handler -> service/repository evidence without selecting unrelated
      `*Action` capabilities through framework/layer vocabulary.
- [ ] Default eval harness includes a historical-inventory variant that omits
      current-run `project-inventory.json` input and selects capability evidence
      from a governed inventory knowledge artifact.
- [ ] Runner automatically discovers the latest prior per-run project inventory
      artifact when the current invocation has no `project-inventory.json`
      input and no governed inventory knowledge artifact is supplied.
- [ ] `project-inventory.json` includes a bounded `sourceChunkIndex` manifest
      whose entries carry `contentSha256`, path/window, source refs, and linked
      inventory record refs for each emitted source chunk.
- [ ] ContextPack can consume `sourceChunkIndex` entries from current or
      historical inventory JSON to recover missing source chunk link refs before
      selecting bounded `code_probe` source evidence.
- [ ] Source chunk index generation and task-time source chunk catalog `q`
      query vector derivation share one embedding provider abstraction.
- [ ] The default embedding provider remains local, deterministic, dependency
      free, and network-free.
- [ ] Injected provider vectors are used only when valid and compatible, and
      invalid/provider failure falls back to the local deterministic vector.
- [ ] Task-time catalog vector queries carry the embedding model when known, and
      catalog vector scoring does not mix same-dimension rows from another
      embedding model.
- [ ] Embedding providers receive only bounded lexical/search text, never raw
      snippets or raw inventory/source-index JSON.
- [ ] Exact linked-record source chunk catalog fallback remains ref-only and
      sends no `q`, `queryEmbedding`, or `queryEmbeddingModel`.
- [ ] Static table-name references in source-like repository/service files link
      scanned SQL table domain entities to bounded code source chunks without
      inspecting a live database, inferring ORM/runtime behavior, or selecting
      sibling data domains.
- [ ] Schema-qualified static SQL table references in source-like non-test
      files link scanned table entities when the final segment exactly matches
      the table, including quoted and bracketed identifier forms, while
      excluding suffix-only names and dynamic schema expressions.
- [ ] Static `.sql` foreign-key clauses link scanned table domain entities in
      both directions through source-ref backed relationship metadata, and
      ContextPack can use those links plus `sourceChunkIndex` refs to retrieve
      the referencing or referenced table evidence without DB inspection, ORM
      inference, sibling data-domain leakage, or raw inventory JSON.
- [ ] Static SQL `FROM ... JOIN ...` statements in source-like non-test files
      and `.sql` files link scanned table domain entities in both directions
      through source-ref backed join relationship metadata, and ContextPack can
      use those links plus `sourceChunkIndex` refs to retrieve the directly
      joined table/query evidence without DB inspection, ORM inference, dynamic
      SQL reconstruction, sibling data-domain leakage, or raw inventory JSON.
- [ ] Static `.sql` `CREATE VIEW` and `CREATE OR REPLACE VIEW` statements emit
      source-ref backed view domain entities, link those views to scanned table
      dependencies through static `FROM` / `JOIN` identifiers, and ContextPack
      can use those links plus `sourceChunkIndex` refs to retrieve the view SQL
      plus directly dependent table evidence without DB inspection, ORM
      inference, dynamic SQL reconstruction, sibling data-domain leakage, or
      raw inventory JSON.
- [ ] Static `.sql` `CREATE PROCEDURE`, `CREATE PROC`, and `CREATE FUNCTION`
      statements emit source-ref backed routine domain entities, link those
      routines to scanned table dependencies through static `FROM`, `JOIN`,
      `UPDATE`, `INSERT INTO`, `DELETE FROM`, and `MERGE INTO` identifiers, and
      ContextPack can use those links plus `sourceChunkIndex` refs to retrieve
      the routine SQL plus directly dependent table evidence without DB
      inspection, ORM inference, dynamic SQL reconstruction, sibling
      data-domain leakage, or raw inventory JSON.

## Out Of Scope For Current Increment

- Adding new parser dependencies.
- Broad multi-language parser-backed symbol graphs beyond the TS/JS first
  slice.
- Real managed vector/embedding retrieval service or index beyond the optional
  injected provider signal.
- Cross-run RAG over historical inventories, accepted knowledge, and source
  chunks beyond the current-run inventory artifact.
- A broad real-project eval corpus; the current increment adds deterministic
  fixture coverage only.

## Technical Notes

- Scanner implementation: `apps/runner/src/project-inventory.ts`
- ContextPack selection: `apps/runner/src/context/builder.ts`
- Primary tests: `apps/runner/test/project-inventory.test.ts`,
  `apps/runner/test/context-builder.test.ts`
- Prior capability-map task: `.trellis/tasks/archive/2026-07/07-01-legacy-project-capability-map-bootstrap/`
- Relevant spec: `.trellis/spec/runner/backend/flow-registry.md`
