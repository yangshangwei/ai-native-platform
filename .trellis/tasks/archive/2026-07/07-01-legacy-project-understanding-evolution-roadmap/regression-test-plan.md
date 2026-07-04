# Regression Test Plan

## Focused Tests

```bash
bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts
```

Must cover:

- route detection examples across common frameworks;
- Go Gorilla mux-style `HandleFunc(...).Methods(...)` chains expand quoted
  methods and `http.Method*` constants into separate route entrypoints while
  preserving handler symbol graph evidence;
- Fastify same-file static `register(plugin, { prefix: "..." })` routes
  combine the register prefix with shorthand and object-literal route
  declarations inside the registered plugin function, cite plugin declaration,
  register, and route lines, preserve route -> handler graph evidence, and do
  not also emit unprefixed plugin routes;
- Flask Blueprint routes combine static `url_prefix` values with decorated
  route paths and cite both the Blueprint definition and route decorator lines;
- Flask same-file `app.register_blueprint(bp, url_prefix=...)` routes combine
  the registration prefix with decorated Blueprint route paths and cite
  Blueprint definition, registration, route decorator, and handler lines;
- Flask static `add_url_rule(...)` registrations with simple function
  `view_func=some_view`, or MethodView registrations with
  `view_func=SomeView.as_view(...)` and static `methods=[...]`, produce source-
  ref backed route entrypoints, map HTTP methods to function handlers or class
  methods such as `SomeView.post`, and preserve route -> view handler ->
  service/repository graph evidence without executing Flask route maps or
  resolving dynamic view functions;
- FastAPI `APIRouter(prefix=...)` routes combine static prefix values with
  decorated route paths and cite both the router definition and route decorator
  lines;
- FastAPI same-file `include_router(router, prefix=...)` routes combine the
  include prefix with the router's static `APIRouter(prefix=...)` value and
  cite the router definition, include call, and route decorator lines;
- Hapi.js `server.route(...)` calls support both static object literals and
  static arrays of object literals when the receiver is proven through
  `@hapi/hapi` / `hapi` construction evidence, preserve handler graph evidence,
  cite each array item's object line, reject local `.route([...])`
  lookalikes without Hapi import/require evidence, and the scanner-real
  `eval/scenarios/legacy-project-understanding-hapi-e2e.json` fixture exercises
  array registration while retaining domain-focused ContextPack selection and
  sibling-domain rejection;
- Hono routes from static `new Hono()` constructor evidence combine
  `.basePath(...)` with route declarations, cite the Hono import/constructor
  and route lines, follow same-file `app.route(prefix, child)` mounts, and
  reject local Hono lookalikes without `hono` import/require evidence;
- Django static `path("prefix/", include("app.urls"))` URLConf mounts and
  static tuple includes such as
  `path("prefix/", include(("app.urls", "app"), namespace="app"))` combine the
  project-level prefix with child `path(...)` routes when the target
  `app/urls.py` file is present, cite both URLConf files, do not create a fake
  route for the parent include call, and ignore dynamic tuple module targets;
- Laravel same-file static `Route::prefix("...")->group(...)` blocks combine
  the group prefix with nested `Route::get/post/...` or `Route::match(...)`
  routes, cite both the group line and route line, and keep controller action
  handler resolution intact;
- Laravel same-file static Route chains where `prefix(...)` is not the first
  chain segment, such as `Route::middleware(...)->prefix(...)->group(...)`,
  combine the group prefix with nested routes and cite both group and route
  lines;
- Laravel static controller groups such as
  `Route::controller(BillingController::class)->prefix(...)->group(...)`
  combine the group prefix with nested `Route::get/post/...` routes, resolve
  quoted string actions such as `"approveRefund"` to
  `BillingController@approveRefund`, cite both group and route lines, and keep
  controller -> service/repository graph evidence source-backed without
  inferring dynamic controller values or runtime route tables;
- CLI script filtering;
- job/queue dedupe;
- route capability grouping and labels;
- parser-backed TS/JS imports, exports, methods, and symbol graph edges;
- NestJS-style `@Controller(...)` plus `@Get/Post/...` TypeScript decorators
  combine class and method route prefixes, cite controller decorator, route
  decorator, and method symbol lines, and produce route -> method graph edges;
- NestJS/TypeScript constructor parameter properties such as
  `constructor(private readonly workflow: BillingWorkflow) {}` and
  `constructor(private billingService: BillingService) {}` act as conservative
  `this.<field>` receiver evidence for decorated controller methods, preserving
  route -> controller method -> concrete service/implementation class -> method
  graph edges with source refs. Interface-typed parameter properties resolve
  only when exactly one scanned concrete implementation exists; Nest provider
  metadata, string tokens, decorators, modules, and container/runtime wiring
  remain out of scope;
- route -> handler and handler -> service/reference graph links;
- Spring-style class-level `@RequestMapping` plus method-level mapping
  annotations produce route -> handler edges for Java controller methods
  without duplicating unmounted method routes as separate capabilities;
- Spring-style Java controller/service/repository classes with explicit
  constructed fields produce source-ref backed `symbol_reference` edges from
  controller handler methods to service classes/methods and onward to
  repository classes/methods;
- Spring XML MVC static `SimpleUrlHandlerMapping` blocks in old XML config
  files produce `ANY` route entrypoints from `<prop key="/...">beanId</prop>`
  and `<entry key="/..." value-ref="beanId" />` mappings, cite the mapping
  bean, route mapping, and target bean definition lines, resolve same-file bean
  ids to concrete controller classes, and map those routes to
  `Controller#handleRequest` graph evidence;
- Spring XML MVC static URL bean names such as
  `<bean name="/billing/statements.htm statementController" class="...Controller" />`
  and conservative `/...` bean `id` values produce `ANY` route entrypoints,
  cite the bean definition line, resolve the controller class, and map those
  routes to `Controller#handleRequest` graph evidence while ignoring dynamic
  `${...}` names;
- Spring XML MVC route-handler evidence reuses the conservative Java explicit
  constructed service/repository graph chain without inferring
  `DispatcherServlet`, `ViewResolver`, `HandlerAdapter`, bean aliases/imports,
  parent contexts, DI/container wiring, interceptors, or runtime mappings;
- JAX-RS / Jakarta REST Java resources with application-level
  `@ApplicationPath(...)`, class-level `@Path(...)` prefixes, and method-level
  `@GET` / `@POST` plus `@Path(...)` annotations produce combined HTTP route
  entrypoints, route -> handler graph edges, and conservative explicit
  service/repository symbol-reference edges without inferring DI/container
  wiring;
- JAX-WS / SOAP Java services with static `@WebService(...)` class annotations
  and non-excluded `@WebMethod(...)` operation annotations produce source-ref
  backed service-operation entrypoints, `Class#method` route -> handler graph
  edges, and conservative explicit service/repository symbol-reference edges
  without inferring WSDL descriptors, SOAP handlers, interceptors,
  DI/container wiring, or dynamic endpoint publication;
- Java Servlet classes with static `@WebServlet(...)` single paths,
  `urlPatterns = "..."`, and `urlPatterns = { ... }` annotations produce
  combined HTTP route entrypoints, map servlet methods such as `doGet` and
  `doPost` to HTTP methods, and produce route -> handler graph edges plus
  conservative explicit service/repository symbol-reference edges without
  inferring servlet container, filter, listener, DI, or dynamic registration
  wiring;
- Java Servlet `WEB-INF/web.xml` deployment descriptors with static
  servlet-name / servlet-class / url-pattern mappings produce combined HTTP
  route entrypoints, resolve the target Servlet class, map implemented servlet
  methods such as `doGet` and `doPost` to HTTP methods, and produce route ->
  handler graph edges plus conservative explicit service/repository
  symbol-reference edges without inferring filters, listeners, init-param
  behavior, DI, dynamic registration, or runtime container wiring;
- Struts XML action mappings from static Struts2 `struts.xml` package/action
  declarations and Struts1 `struts-config.xml` action mappings produce HTTP
  route entrypoints, map Action classes to static handler methods such as
  `execute`, and produce route -> handler graph edges plus conservative
  explicit service/repository symbol-reference edges without inferring
  wildcard actions, interceptors, forwards/results, dynamic method dispatch,
  DI, or runtime framework wiring;
- CodeIgniter 2/3 `application/config/routes.php` assignments with static
  route paths and static `controller/method` targets produce source-ref backed
  HTTP route entrypoints, map to controller action methods, and produce
  conservative explicit PHP service/repository symbol-reference edges without
  inferring `default_controller`, `404_override`, wildcard routes,
  `(:num)` / `(:any)` patterns, callbacks, hooks, libraries, loaders,
  URI dash translation, or runtime framework routing;
- CakePHP 2/3 `Router::connect(...)` assignments in `app/Config/routes.php`
  or `config/routes.php` with static route paths and static controller/action
  array targets produce source-ref backed HTTP route entrypoints, map to
  controller action methods, and produce conservative explicit PHP
  service/repository symbol-reference edges without inferring dynamic route
  patterns, plugin routing, prefixes, named params, passed args, callbacks, or
  runtime route inspection;
- Yii/Yii2 URL manager rules in common PHP config paths such as
  `config/web.php`, `config/main.php`, `common/config/main.php`,
  `frontend/config/main.php`, `backend/config/main.php`, and
  `protected/config/main.php` with literal string-map rules or literal
  array-style `pattern` / `route` rules produce source-ref backed HTTP route
  entrypoints, map to `Controller::action*` methods, and produce conservative
  explicit PHP service/repository symbol-reference edges without inferring Yii
  modules, callbacks, imports, DI/container wiring, or runtime route
  inspection;
- Zend Framework 1 `application.ini` router resources with literal
  `resources.router.routes.*.route`, `defaults.controller`, and
  `defaults.action` values produce source-ref backed HTTP route entrypoints,
  map to `Controller::action*Action` methods, and produce conservative
  explicit PHP service/repository symbol-reference edges without inferring
  dynamic route resources, custom route classes, front-controller plugins,
  DI/container wiring, or runtime route inspection;
- Drupal 7 `.module` files with static `hook_menu()` definitions and literal
  `$items['...'] = array(...)` menu paths plus literal `page callback`
  functions produce source-ref backed HTTP route entrypoints, map to same-file
  callback function symbols, resolve literal `drupal_get_form` callbacks
  through the first literal `page arguments` form function, and produce
  conservative explicit PHP service/repository symbol-reference edges without
  inferring dynamic form builders, menu loaders, access callbacks, includes,
  module weights, DI/container wiring, or Drupal runtime route inspection;
- WordPress plugin PHP files with static `add_action(...)` calls for literal
  `admin_post_*`, `admin_post_nopriv_*`, `wp_ajax_*`, and `wp_ajax_nopriv_*`
  hooks produce source-ref backed HTTP route entrypoints, map literal callback
  functions or static class callbacks to source-backed handler symbols, and
  produce conservative explicit PHP service/repository symbol-reference edges
  without inferring instance callbacks, shortcodes, includes, plugin load
  order, nonce/capability checks, DI/container wiring, or WordPress runtime
  dispatch;
- WordPress plugin PHP files with static `register_rest_route(...)` calls
  produce source-ref backed REST route entrypoints when namespace, route path,
  callback function or static class callback, and methods are literal or known
  `WP_REST_Server::*` constant evidence, map to source-backed handler symbols,
  expand REST method constants such as `EDITABLE` into concrete HTTP methods,
  and produce conservative explicit PHP service/repository symbol-reference
  edges without inferring instance callbacks, permission callbacks, includes,
  plugin load order, nonce/capability checks, DI/container wiring, or WordPress
  runtime dispatch;
- Symfony YAML `app/config/routing.yml` and `config/routes.yaml` static route
  blocks with literal `path` / `pattern` and literal `_controller` /
  `controller` targets produce source-ref backed HTTP route entrypoints, map
  bundle/FQCN targets to controller action methods when the target method
  symbol is present, and produce conservative explicit PHP service/repository
  symbol-reference edges without inferring placeholders, imports,
  service-container routes, annotations, bundle config imports, callbacks,
  DI/container wiring, or runtime route inspection;
- Symfony XML `app/config/routing.xml` and `config/routes.xml` static
  `<route>` elements with literal `path` / `pattern` and literal
  `_controller` / `controller` default or attribute targets produce
  source-ref backed HTTP route entrypoints, map bundle/FQCN targets to
  controller action methods when the target method symbol is present, and
  produce conservative explicit PHP service/repository symbol-reference edges
  without inferring placeholders, imports, service-container routes,
  annotations, bundle config imports, callbacks, DI/container wiring, or
  runtime route inspection;
- ASP.NET-style `[Route]` plus `[HttpGet]` / `[HttpPost]` attributes produce
  route -> handler edges for C# action methods, including `[controller]` token
  expansion;
- ASP.NET-style C# controller/service/repository classes with explicit
  constructed fields produce source-ref backed `symbol_reference` edges from
  action methods to service classes/methods and onward to repository
  classes/methods;
- WCF / .NET service contracts with static `[ServiceContract(...)]`
  interfaces or classes and `[OperationContract(...)]` methods produce
  source-ref backed service-operation entrypoints, route -> handler graph
  edges, unique interface implementation resolution when one static
  implementation exists, and conservative explicit service/repository
  symbol-reference edges without inferring endpoint config, bindings, hosts,
  DI/container wiring, or dynamic service publication;
- WCF `.svc` service host files with static `<%@ ServiceHost ... Service="..." %>`
  directives produce source-ref backed host entrypoints from the service host
  path, handle static assembly-qualified service type names, map to the
  concrete service class symbol only when one scanned class match is present,
  keep ambiguous class-name matches unresolved, stay grouped with the same
  service capability as `[OperationContract]` operations, and keep
  `web.config` endpoint/binding inference, factories, dynamic service names,
  DI/container wiring, and runtime service publication out of scope;
- ASMX / .NET WebService classes with static `[WebService(...)]` class
  attributes and `[WebMethod(...)]` methods produce source-ref backed
  service-operation entrypoints, route -> handler graph edges, and
  conservative explicit service/repository symbol-reference edges without
  inferring `.asmx` directives, IIS mappings, SOAP extensions, config
  bindings, DI/container wiring, or dynamic service publication;
- ASP.NET Web Forms `.aspx` pages with static Page directives and
  `Inherits="..."` code-behind classes produce source-ref backed page
  entrypoints derived from static page paths, map conservatively to
  `PageClass#Page_Load`, and reuse conservative explicit C# service/repository
  symbol-reference edges without inferring master pages, user controls,
  declarative event handlers, dynamic page routing, IIS configuration,
  DI/container wiring, or lifecycle events beyond `Page_Load`;
- Old ASP.NET MVC/Web API route tables with static `MapRoute(...)` and
  `MapHttpRoute(...)` calls produce source-ref backed route entrypoints only
  when `url` / `routeTemplate` and `controller`/`action` defaults are static
  string evidence, map conservatively to `Controller#Action`, and reuse
  conservative explicit C# service/repository symbol-reference edges without
  expanding broad conventional route templates such as
  `{controller}/{action}/{id}`, route constraints, route collections,
  filters, areas, bundles, IIS configuration, or dynamic route registration;
- Play Framework `conf/routes` files with static HTTP methods, literal paths,
  and Java controller targets such as
  `controllers.BillingController.approveRefund(...)` produce source-ref backed
  route entrypoints, map to `Controller#action`, and reuse conservative
  explicit Java service/repository symbol-reference edges without inferring
  reverse routes, Scala controllers, wildcard/static-asset routes, dependency
  injection, or runtime router behavior;
- Legacy JSP `.jsp` files under web roots such as `src/main/webapp` produce
  source-ref backed static page route entrypoints and bounded source chunk
  evidence without inferring tag libraries, includes, form actions, servlet
  container mappings, scriptlet call graphs, DI/container wiring, or runtime
  page dispatch behavior;
- Classic ASP `.asp` files under web roots such as `web` produce source-ref
  backed static page route entrypoints and bounded source chunk evidence
  without inferring server-side includes, form actions, COM objects, ADO calls,
  IIS mappings, VBScript call graphs, DI/container wiring, or runtime page
  dispatch behavior;
- ColdFusion `.cfm` / `.cfml` files under web roots such as `wwwroot` produce
  source-ref backed static page route entrypoints and bounded source chunk
  evidence without inferring `cfinclude`, `cfform`, CFC components,
  datasources, application mappings, scheduled tasks, CFML call graphs,
  DI/container wiring, or runtime page dispatch behavior;
- Go route handlers with explicit local constructed receivers such as
  `service := NewBillingService()` and `repo := &BillingRepository{}` produce
  source-ref backed `symbol_reference` edges from handler functions to service
  types/methods and onward to repository types/methods;
- Laravel/PHP controller/service/repository classes with explicit local
  constructed receivers such as `$service = new CustomerService()` produce
  source-ref backed `symbol_reference` edges from controller actions to service
  classes/methods and onward to repository classes/methods;
- Laravel prefix-group mounted routes still resolve controller actions and
  preserve route -> controller -> service/repository graph evidence without
  selecting unrelated same-project capabilities;
- Laravel controller-group mounted routes still resolve nested string actions
  to the static group controller and preserve route -> controller ->
  service/repository graph evidence without treating arbitrary quoted strings
  outside a controller group as controller methods;
- Laravel static invokable controller routes such as
  `Route::get("...", HealthCheckController::class)` resolve to conventional
  `HealthCheckController@__invoke` handlers and link to source-backed
  `__invoke` method symbols;
- Laravel static `Route::resource(...)` and `Route::apiResource(...)` routes
  expand to RESTful controller action entrypoints, honor static `only()` /
  `except()` action filters, inherit static prefix groups, cite both group and
  resource lines, and link resolvable controller actions through `symbolGraph`
  route-handler evidence;
- Slim/Silex-style static PHP routes such as
  `$app->post("...", [BillingController::class, "approveRefund"])` and
  `$app->get("...", "CustomerController:profile")` produce source-ref backed
  route entrypoints, map to `Slim:Controller@action`, and reuse conservative
  explicit PHP service/repository symbol-reference edges without treating
  arbitrary object calls, closure handlers, wildcard routes, DI/container
  wiring, middleware, or runtime route inspection as static evidence;
- Sinatra-style Ruby block routes in explicit Sinatra files produce bounded
  source-ref backed route entrypoints from static `get/post/... "/path" do`
  declarations, preserve route block source refs for ContextPack selection,
  and exclude dynamic paths, wildcard routes, interpolated paths, Rack mounts,
  runtime dispatch, and fake handler symbols for inline blocks;
- Rails static root routes such as `root to: "dashboard#index"` and
  `root "admin/dashboard#show"` produce source-ref backed `GET /` or scoped
  root entrypoints, map to controller action graph evidence, reuse the
  conservative Ruby service/repository chain, and exclude redirect roots,
  dynamic targets, block routes, and runtime Rails routing;
- Rails singular resource routes such as `resource :account` produce
  source-ref backed RESTful route entrypoints without `:id` segments, honor
  static `only:` / `except:` action filters, map to conventional plural
  controller action graph evidence such as `AccountsController#update`, reuse
  the conservative Ruby service/repository chain, and exclude dynamic resource
  names or runtime Rails routing;
- Rails legacy hashrocket route targets such as
  `get "/billing/refunds/:id" => "billing#show_refund"` and
  `match "/billing/refunds/:id/reopen" => "billing#reopen_refund", via: :post`
  produce source-ref backed route-handler graph evidence while excluding
  no-`via` hashrocket matches, dynamic targets, redirects, implicit route
  targets, and runtime Rails routing;
- Rails/Ruby controller/service/repository classes with explicit local
  constructed receivers such as `service = ReportService.new` produce
  source-ref backed `symbol_reference` edges from controller actions to service
  classes/methods and onward to repository classes/methods;
- Rails/Ruby `require_dependency` statements resolve uniquely matched scanned
  files under Rails-style `app/` or `lib/` load paths, so explicit dependency
  evidence prevents constructed receivers from linking to unrelated same-named
  shadow classes while still avoiding broad Rails autoload inference;
- Rails/Ruby qualified class declarations such as `class Billing::RefundService`
  are recorded as leaf class symbols (`RefundService`) and keep namespaced
  constructed receiver chains source-backed through service and repository
  methods without linking namespace container names or unrelated shadow classes;
- Rails/Ruby constructed receivers with explicit global namespace constants,
  such as `service = ::Billing::RefundService.new`, preserve the same
  controller -> service -> repository graph edges and cite the explicit
  dependency/call-site evidence without invoking runtime constant lookup;
- Rails explicit controller-path route targets such as
  `to: "admin/billing#approve_refund"` preserve path-aware handler evidence,
  resolve to `app/controllers/admin/billing_controller.rb`, and continue into
  explicit controller -> service/repository graph edges without inferring Rails
  autoload namespaces or route-scope controller modules;
- Rails same-file static `scope "/prefix" do` blocks combine the scope prefix
  with nested `get/post/...` routes, cite both the scope line and route line,
  and keep route -> controller -> service/repository graph evidence focused on
  the selected capability;
- Rails same-file static `namespace :name do` blocks combine the namespace path
  prefix with nested routes, cite both namespace and route lines, and do not
  infer Rails controller module namespaces;
- Rails static `resources :name` routes expand to RESTful entrypoints, honor
  static `only:` / `except:` action filters, inherit static scope prefixes, cite
  both scope and resources lines, and link resolvable controller actions through
  `symbolGraph` route-handler evidence without selecting unrelated same-domain
  sibling actions in task-focused ContextPack output;
- Rails legacy `match "/path", to: "...#...", via: ...` routes produce
  source-ref backed route entrypoints when the path, target, and `via` methods
  are static, inherit static scope prefixes, expand symbol/string/array/
  `%i[...]`/`:all` method evidence, link resolvable controller actions through
  `symbolGraph` route-handler evidence, and exclude missing-`via`, dynamic,
  wildcard, constrained, and block-routed match declarations;
- Flask/Python route handlers and Python service/repository classes with
  explicit local constructed receivers such as `service = BillingService()`
  produce source-ref backed `symbol_reference` edges from handler functions to
  service classes/methods and onward to repository classes/methods;
- Flask/Python MethodView class methods selected through static
  `add_url_rule(..., view_func=View.as_view(...), methods=[...])` behave like
  route handlers for symbol graph purposes and keep explicit service/repository
  receiver edges source-backed;
- Python import aliases on constructed receivers, such as
  `from services.billing_service import BillingService as BillingSvc` followed
  by `service = BillingSvc()`, normalize graph edge labels and targets to the
  resolved class symbol while preserving import, constructor, call-site, and
  target source refs;
- Python namespace imports on constructed receivers, such as
  `import services.billing_service as billing_service` followed by
  `service = billing_service.BillingService()`, resolve through static local
  import evidence and emit canonical service/repository graph labels without
  executing Python imports or following dynamic import machinery;
- Unaliased multi-segment Python namespace imports, such as
  `import services.billing_service` followed by
  `service = services.billing_service.BillingService()`, resolve only when the
  full namespace expression matches a static local import specifier, avoiding
  sibling-module links through a shared top-level package;
- Python relative imports, such as
  `from .services.billing_service import BillingService` and
  `from ..repositories.billing_repository import BillingRepository`, keep
  explicit constructed receiver graph edges canonical and source-backed for
  package-relative service/repository chains;
- Python package-relative module imports, such as
  `from .services import billing_service` followed by
  `billing_service.BillingService()` and
  `from ..repositories import billing_repository` followed by
  `billing_repository.BillingRepository()`, resolve to the imported module
  file before constructed receiver normalization and avoid same-named shadow
  module targets;
- Python package re-exports through `__init__.py`, such as
  `from .services import BillingService` where `services/__init__.py` imports
  `BillingService` from `.billing_service`, resolve through bounded static
  import evidence and preserve both re-export source refs and target symbol
  refs;
- Python package namespace imports with `__init__.py` re-exports, such as
  `from . import services` or `from legacy_billing import services` followed
  by `services.BillingService()`, preserve canonical service/repository graph
  edges and avoid same-named shadow module targets in both scanner tests and
  scanner-to-ContextPack eval coverage;
- Conservative Python star imports from local scanned modules/packages, such
  as `from .services import *` where `services/__init__.py` statically
  re-exports `BillingService`, expand bounded public names into import evidence
  and preserve canonical service/repository graph edges without linking
  same-named shadow modules;
- Python star imports that expose local module namespaces, such as
  `from .services import *` paired with `from . import billing_service` inside
  `services/__init__.py`, emit namespace import evidence for
  `billing_service.BillingService()` style receivers and preserve canonical
  service/repository graph edges;
- Python star import expansion honors static `__all__` list/tuple string
  literals in scanned local packages, so `from .services import *` exposes
  only the module namespaces or public names explicitly listed by `__all__` and
  does not link unlisted sibling modules;
- PHP fully qualified constructed receivers, such as
  `new \App\Services\BillingService()` and
  `new \App\Repositories\BillingRepository()`, resolve to the corresponding
  scanned class paths and preserve controller -> service -> repository graph
  edges without requiring `use` imports or linking same-named shadow classes;
- PHP grouped `use` imports, such as
  `use App\Repositories\{BillingRepository as BillingRepo};` and the common
  multi-line group form, expand into source-ref backed import evidence so
  `new BillingRepo()` resolves to the canonical `BillingRepository` class and
  method graph edges without linking alias names or sibling shadow classes;
- Laravel/PHP service-locator assignments with static class literals, such as
  `$service = app(\App\Services\BillingService::class)` and
  `$repository = \App::make(BillingRepo::class)`, create receiver evidence
  that resolves through FQCN and grouped-alias import evidence, then preserves
  controller -> service -> repository method graph edges without inferring
  string service names, runtime container bindings, or unrelated aliases;
- Laravel/PHP static factory assignments with explicit class receivers, such as
  `$service = \App\Services\BillingService::make()` and
  `$repository = BillingRepo::instance()`, create receiver evidence only for
  the bounded factory-method allowlist and preserve controller -> service ->
  repository method graph edges without treating the Laravel `App` facade as a
  returned receiver;
- Django URLConf include-mounted routes still resolve `views.<name>` handlers
  to sibling `views.py` function symbols and produce route-handler graph edges
  with parent URLConf, child URLConf, and view source refs;
- Django static directly imported function handlers such as
  `path("...", some_view)` resolve to sibling `views.py` function symbols and
  produce route-handler graph edges with URLConf and view-function source refs;
- Django static `views.SomeView.as_view()` and directly imported
  `SomeView.as_view()` class-based view handlers resolve to sibling `views.py`
  class symbols and produce route-handler graph edges with URLConf and
  view-class source refs;
- imported TS/JS route callbacks resolved through local import/export evidence,
  with route-handler graph edges citing route, import, and handler source refs;
- decorator-backed TS/JS class methods use the actual method-name source line
  as the symbol ref rather than the preceding decorator line;
- imported TS/JS service/reference targets resolved through local
  import/export evidence, with symbol-reference graph edges citing call site,
  import, and resolved service source refs rather than same-file fallback
  symbols;
- ContextPack task-time selection from `project-inventory.json` into
  `code_probe` capability/symbol/test/hotspot sections;
- ContextPack task-time selection from governed historical inventory knowledge
  artifacts into `code_probe` sections when the current invocation has no
  `project-inventory.json` input;
- generic-token filtering so unrelated API/test capabilities are not selected;
- framework/layer-token filtering so task words such as `spring`,
  `controller`, `service`, `repository`, and generic load verbs do not select
  unrelated legacy capabilities;
- BM25-style hybrid inventory retrieval for relevant symbol/test/hotspot
  evidence when no capability directly matches;
- symbol graph edge labels participate as first-class hybrid inventory
  retrieval records, so edge-only task terms can select source-ref backed
  call-site evidence and graph-pointed source chunks;
- bounded inventory `sourceChunks` selected as source-ref backed `code_probe`
  sections when task terms match snippets;
- lexical source chunk snippet matches expose a `BM25 score` audit line and
  still exclude unrelated chunks plus raw `project-inventory.json` content;
- source chunk `sourceRefs` and rendered snippets are narrowed to matched task
  lines so adjacent same-file routes or capabilities are not injected as
  selected evidence;
- source chunks selected through hybrid inventory evidence links, with
  unrelated and sensitive chunks excluded;
- source chunks selected through hybrid or graph pointers deduplicate repeated
  pointing records and render the real pointing inventory evidence in the
  selected section content/reason;
- source chunks carry a `contentSha256` hash over bounded source content without
  rendered line labels, and regression coverage proves it stays stable when
  identical code shifts line numbers while the legacy snippet `sha256` changes;
- `project-inventory.json` carries a bounded `sourceChunkIndex` manifest whose
  entries mirror source chunk `contentSha256`, path/window, source refs, and
  linked inventory refs without duplicating source snippets;
- source chunk ContextPack rendering includes a `Content SHA-256` audit line
  when a valid `contentSha256` is available, without selecting raw inventory or
  sensitive chunks;
- explicit 64-character `contentSha256` task hints select only the matching
  bounded source chunk from current-run inventory and accepted historical
  inventory knowledge, render `Matched Content SHA-256`, keep source refs
  grounded in the inventory artifact plus source-file lines rather than the
  hash value, and keep raw historical inventory JSON out of `knowledge_*`
  context;
- when the same explicit `contentSha256` hint matches both current-run and
  historical inventory chunks, current-run source evidence is selected and the
  historical duplicate is suppressed, while historical inventory still acts as
  fallback when no current chunk matches;
- inventory records linked from chunks carry reverse `sourceChunkRefs`, and
  ContextPack regression coverage proves hybrid evidence can select a source
  chunk through that explicit pointer even when the chunk does not carry the
  corresponding forward record ref;
- governed historical inventory knowledge can drive the same source chunk path:
  focused ContextPack tests and the default deterministic eval suite prove a
  hybrid-selected historical symbol may point to a bounded source chunk through
  `sourceChunkRefs`, carrying knowledge artifact refs, original inventory
  artifact refs, and `Content SHA-256` audit evidence without rendering raw
  inventory JSON;
- governed historical inventory knowledge can also recover missing source
  chunk link refs from `sourceChunkIndex.entries` before source chunk
  selection, while keeping the manifest metadata-only and excluding raw
  inventory JSON from normal `knowledge_*` context;
- current-run inventory and accepted historical inventory source chunks with
  the same identity but different valid `contentSha256` values emit a
  structured stale calibration signal, carrying current artifact, historical
  artifact, knowledge artifact, and source line evidence refs without applying
  or mutating historical knowledge automatically. Identity matching covers
  exact chunk id, exact path/window, and same path plus explicit linked
  inventory record refs such as `symbolRefs` / `graphEdgeRefs`, so shifted
  source windows remain comparable without same-file-only matching;
- source chunks can be selected through `symbolGraph` edge backlinks
  (`graphEdgeRefs`), so route/service/repository call-site evidence is
  reachable even when the chunk snippet itself is not the primary lexical match;
- source chunk source refs remain scoped to the chunk file when graph edges span
  multiple files, while graph-edge ids preserve the cross-file relationship;
- source chunk evidence does not render raw `project-inventory.json` as
  `input_*` or historical inventory JSON as `knowledge_*` context;
- static SQL schema files with `CREATE TABLE ...` statements produce
  source-ref backed `table` domain entities, attach `domainEntityRefs` to
  matching capabilities/source chunks/source chunk index entries, and preserve
  bounded SQL source chunks for task-time retrieval;
- source-like repository/service files with explicit static table-name
  references attach `referenceSourceRefs` to the table domain entity and
  `domainEntityRefs` to bounded code source chunks/source chunk index entries
  without inspecting a live database or inferring dynamic SQL/ORM behavior;
- schema-qualified static SQL table references in source-like non-test files
  attach those same table refs when the final segment exactly matches the
  scanned table, including `schema.table`, `"schema"."table"`, and
  `[schema].[table]` forms, while excluding suffix-only identifiers, dynamic
  `${schema}.table` SQL, and test files;
- ContextPack can select capability, domain entity, and pointed SQL source
  chunk `code_probe` sections from business data-layer terms while filtering
  generic `sql` / `schema` / `table` vocabulary, excluding sibling data
  domains, and keeping raw `project-inventory.json` out of normal context;
- capability-map sections remain primary evidence when capability, source
  chunk, and exact source-ref hybrid graph matches coexist; exact line source
  refs may add supplemental graph/source-chunk evidence, but path-only hints
  must not select unrelated same-file hybrid records or source chunks; the
  default deterministic eval scenario measures both variants under
  `contextQualityGates`;
- default eval scenario coverage for capability-map primary selection,
  governed historical inventory reuse, historical `sourceChunkRefs` source
  chunk retrieval, explicit `contentSha256` source chunk hints, historical
  source chunk hash drift signals, unrelated capability exclusion, raw
  inventory exclusion, and hybrid symbol-graph fallback source refs, including
  graph-edge-backed source chunk selection through `graphEdgeRefs`;
- scanner-to-context e2e eval coverage that writes a temporary legacy fixture,
  runs real `buildProjectInventory()`, verifies scanner capability/symbol/edge
  output, scanner-generated source chunk `graphEdgeRefs`, and sensitive
  exclusions, then runs real `buildContextPack()`;
- scanner-to-context e2e eval coverage can source fixture files from a
  checked-in bounded `fixtureDir`, resolved relative to the scenario JSON file
  and guarded against repository-root escape, while still merging inline
  `files[]` and exercising the real inventory -> ContextPack path;
- scanner-to-context e2e eval coverage includes a realistic checked-in
  directory-backed legacy corpus with route/controller/service/repository/test
  layers, SQL schema/view/routine evidence, a sibling customer domain, filtered
  generated/vendor noise, capability/route/symbol/graph/source-ref assertions,
  relevant manifest prefixes, and a low irrelevant-context ratio gate;
- scanner-to-context e2e eval coverage includes a NestJS controller variant
  that selects decorator-derived route/method evidence while excluding
  unrelated Express route evidence;
- scanner-to-context e2e eval coverage includes a JAX-RS / Jakarta REST Java
  resource variant that selects application-level `@ApplicationPath(...)`,
  class-level `@Path(...)`, and method-level HTTP/path annotation evidence
  while excluding unrelated sibling `*Resource` domains;
- scanner-to-context e2e eval coverage includes a JAX-WS / SOAP Java service
  variant that selects static `@WebService(...)`, non-excluded
  `@WebMethod(...)`, and explicit service/repository graph evidence while
  excluding unrelated sibling SOAP service domains;
- scanner-to-context e2e eval coverage includes a Spring XML MVC variant that
  selects static `SimpleUrlHandlerMapping` URL map evidence, static URL bean
  name evidence, same-file bean id resolution, `Controller#handleRequest`, and
  explicit service/repository graph evidence while excluding unrelated
  XML-mapped controller domains and sibling same-capability symbols;
- scanner-to-context e2e eval coverage includes a WCF / .NET service-contract
  variant that selects static `[ServiceContract(...)]` /
  `[OperationContract(...)]` evidence, follows a unique implementation class
  into explicit service/repository graph edges, and excludes unrelated sibling
  WCF service domains;
- scanner-to-context e2e eval coverage includes an ASMX / .NET WebService
  variant that selects static `[WebService(...)]` / `[WebMethod(...)]`
  operation evidence, follows explicit service/repository graph edges, and
  excludes unrelated sibling ASMX service domains;
- scanner-to-context e2e eval coverage includes an ASP.NET Web Forms variant
  that selects static `.aspx` Page directive evidence, `Inherits="..."`
  code-behind class evidence, `Page_Load` handler evidence, explicit
  service/repository graph evidence, and billing tests while excluding
  unrelated customer page/code-behind/test evidence;
- scanner-to-context e2e eval coverage includes an old ASP.NET route-table
  variant that selects static `MapRoute(...)` evidence, `Controller#Action`
  handler evidence, explicit service/repository graph evidence, and billing
  tests while excluding unrelated `MapHttpRoute(...)` customer evidence and
  the broad default `{controller}/{action}` route template;
- scanner-to-context e2e eval coverage includes a legacy JSP variant that
  selects static `.jsp` page route evidence, bounded source chunk evidence,
  and billing tests while excluding unrelated customer page/test evidence;
- scanner-to-context e2e eval coverage includes a Classic ASP variant that
  selects static `.asp` page route evidence, bounded source chunk evidence,
  and billing tests while excluding unrelated customer page/test evidence;
- scanner-to-context e2e eval coverage includes a ColdFusion variant that
  selects static `.cfm` page route evidence, bounded source chunk evidence, and
  billing tests while excluding unrelated customer page/test evidence;
- scanner-to-context e2e eval coverage includes a legacy CodeIgniter variant
  that selects static route config evidence, controller action evidence,
  explicit service/repository graph evidence, and billing tests while
  excluding unrelated customer route/controller/test evidence and dynamic
  route patterns;
- scanner-to-context e2e eval coverage includes a legacy CakePHP variant that
  selects static route config evidence, controller action evidence, explicit
  service/repository graph evidence, and billing tests while excluding
  unrelated customer route/controller/test evidence and dynamic route patterns;
- scanner-to-context e2e eval coverage includes a legacy Yii/Yii2 variant that
  selects static URL manager rule evidence, controller action evidence,
  explicit service/repository graph evidence, and billing tests while excluding
  unrelated customer route/controller/test evidence and nonliteral route rules;
- scanner-to-context e2e eval coverage includes a legacy Zend Framework 1
  variant that selects static `application.ini` router resource evidence,
  controller action evidence, explicit service/repository graph evidence, and
  billing tests while excluding unrelated customer route/controller/test
  evidence and dynamic route values;
- scanner-to-context e2e eval coverage includes a legacy Drupal 7 variant that
  selects static `.module` `hook_menu()` evidence, page callback function
  evidence, explicit service/repository graph evidence, and billing tests while
  excluding unrelated customer route/callback/test evidence and dynamic page
  callback values;
- scanner-to-context e2e eval coverage includes a legacy Drupal 7
  `drupal_get_form` variant that selects static `.module` `hook_menu()`
  evidence, literal form callback function evidence, explicit
  service/repository graph evidence, and billing form tests while excluding
  unrelated customer form route/test evidence and dynamic form ids;
- scanner-to-context e2e eval coverage includes a legacy WordPress plugin
  variant that selects static `admin_post_*` / `wp_ajax_*` hook evidence,
  callback function evidence, explicit service/repository graph evidence, and
  billing tests while excluding sibling AJAX/customer hook evidence and dynamic
  hook/callback values;
- scanner-to-context e2e eval coverage includes a legacy WordPress REST plugin
  variant that selects static `register_rest_route(...)` evidence, callback
  function evidence, explicit service/repository graph evidence, and billing
  REST tests while excluding sibling customer REST route evidence and dynamic
  REST values;
- scanner-to-context e2e eval coverage includes a legacy WordPress
  class-callback variant that selects static array callback evidence, class
  method evidence, explicit service/repository graph evidence, and billing
  tests while excluding sibling customer route evidence and dynamic callback
  variables;
- scanner-to-context e2e eval coverage includes a legacy Symfony YAML variant
  that selects static route config evidence, controller action evidence,
  explicit service/repository graph evidence, and billing tests while
  excluding unrelated customer route/controller/test evidence, placeholders,
  and imports;
- scanner-to-context e2e eval coverage includes a legacy Symfony XML variant
  that selects static route config evidence, controller action evidence,
  explicit service/repository graph evidence, and billing tests while
  excluding unrelated customer route/controller/test evidence, placeholders,
  imports, service-container controller ids, and callbacks;
- scanner-to-context e2e eval coverage includes a legacy Sinatra variant that
  selects static billing route block evidence, bounded source chunk evidence,
  and billing tests while excluding sibling customer routes, dynamic route
  expressions, wildcard routes, and raw inventory JSON;
- scanner-to-context e2e eval coverage includes a legacy Rails `match` variant
  that selects static match-route evidence, controller action evidence,
  explicit service/repository graph evidence, and billing tests while
  excluding sibling customer routes, no-`via` routes, dynamic route
  expressions, wildcard routes, and raw inventory JSON;
- scanner-to-context e2e eval coverage includes a Java Servlet variant that
  selects static `@WebServlet(...)` url-pattern evidence and servlet handler
  methods while excluding unrelated servlet domains;
- scanner-to-context e2e eval coverage includes a Java `web.xml` Servlet
  variant that selects deployment descriptor servlet mapping evidence and
  servlet handler methods while excluding unrelated servlet domains;
- scanner-to-context e2e eval coverage includes a Struts variant that selects
  static XML action mapping evidence and Action handler methods while excluding
  unrelated `*Action` domains;
- same-file route capabilities are not cross-selected through encoded ids,
  source refs, path-only matching, test paths, or hotspot paths;
- matched multi-entrypoint capabilities do not inject same-domain sibling route
  or method source refs when the task-focused entrypoint and symbolGraph chain
  can be identified;
- graph-focused multi-entrypoint capability selection does not reintroduce
  sibling symbols through broad text matches after the selected entrypoint's
  route -> handler -> service graph chain has been identified;
- multi-entrypoint capability narrowing uses graph-reachable symbol text while
  ranking entrypoints, so task terms that appear in a handler/service/repository
  chain can select the right route and exclude sibling REST actions that only
  share the broad route noun;
- source chunks selected through focused inventory pointers cite pointed source
  lines before broad lexical line matches, so adjacent same-file routes remain
  excluded;
- historical inventory knowledge artifacts are excluded from normal
  `knowledge_*` section rendering so raw inventory JSON is not injected as
  prose context;
- project-page capability map rendering from latest inventory artifacts;
- accept/rename/merge/mark-wrong action surface for inventory capabilities;
- capability corrections persisted as draft governed knowledge candidates with
  source refs, structured evidence refs, inventory record refs, and
  review-required metadata;
- accepted capability correction `evidenceRefs` are merged into later
  ContextPack correction evidence so inventory record ids such as entrypoints,
  symbols, tests, and hotspots remain auditable beyond the initial UI action;
- project-page capability rows compare current scan capabilities against
  persisted capability correction artifacts, including corrections from prior
  inventory artifacts;
- project-page capability rows treat accepted corrections with
  `reviewStatus='none'` as governed and prefer them over newer draft or
  review-required corrections for the same capability;
- accepted, non-review-required capability-map corrections feed later
  inventory-driven ContextPack selection without injecting correction artifacts
  as standalone knowledge context: rename/merge metadata can match and annotate
  the capability probe, while mark-wrong suppresses the heuristic capability and
  preserves source-backed hybrid evidence;
- default eval coverage for accepted rename and merge corrections proves tasks
  using the corrected label or merge target select the original inventory
  capability, attached symbols, tests, and hotspots while excluding the
  correction artifacts from normal `knowledge_*` context;
- hybrid and source chunk fallback evidence linked to a capability suppressed by
  an accepted mark-wrong correction carries the correction artifact/source refs
  and review text while remaining `code_probe` evidence;
- draft or review-required capability-map corrections are ignored for inventory
  matching/suppression until governance accepts them without a review-required
  status;
- default eval coverage for review-required rename and merge corrections proves
  tasks using the corrected label or merge target do not select the original
  inventory capability, corrected-label sections, or correction artifact refs;
- accepted, non-review-required capability corrections whose `capabilityId` is
  missing from the current-run inventory emit a stale calibration/review signal
  and do not apply to unrelated current capabilities;
- valid current-run inventories with an empty `capabilities` array still emit
  stale correction signals for accepted corrections whose old capability id is
  absent;
- accepted, non-review-required rename/merge corrections whose old
  `capabilityId` is missing but whose corrected label or merge target matches a
  current capability display label emit a superseded calibration/review signal,
  while selected current capability sections omit the old correction source
  refs and review text;
- accepted, non-review-required rename/merge corrections whose old
  `capabilityId` is missing but whose corrected label or merge target matches
  multiple current capability display labels emit a conflict calibration/review
  signal with every matching capability/source ref, while selected current
  capability sections omit the old correction artifact/source refs/review text;
- correction drift eval coverage asserts structured calibration signal fields:
  kind, severity, recommended action, message text, subject refs, and evidence
  refs, with a red fixture proving missing signal evidence fails;
- context-governance API and task-detail UI coverage expose and render
  calibration/review signal count plus kind, severity, recommended action,
  subject refs, and evidence refs so stale correction drift is visible to
  human reviewers;
- sensitive/generated/binary/oversized exclusions remain enforced.
- framework/layer task tokens such as `jax`, `jaxrs`, `resource`, `resources`,
  and `rest` do not select unrelated legacy capabilities solely through
  framework naming conventions.
- framework/layer task tokens such as `servlet` and `servlets` do not select
  unrelated legacy capabilities solely through servlet class naming
  conventions.
- framework/layer task tokens such as `struts`, `action`, and `actions` do not
  select unrelated legacy capabilities solely through Struts class naming
  conventions.
- framework/layer task tokens such as `soap`, `web`, `webservice`,
  `webmethod`, `operation`, and `method` do not select unrelated legacy
  capabilities solely through SOAP service naming conventions.
- framework/layer task tokens such as `wcf`, `contract`, `servicecontract`,
  and `operationcontract` do not select unrelated legacy capabilities solely
  through WCF service naming conventions.
- framework/layer task tokens such as `asmx`, `web`, `webservice`, and
  `webmethod` do not select unrelated legacy capabilities solely through ASMX
  WebService naming conventions.
- framework/layer task tokens such as `asp`, `aspnet`, `net`, `form`,
  `forms`, `page`, `pages`, and `webforms` do not select unrelated legacy
  capabilities solely through ASP.NET Web Forms naming conventions.
- framework/layer task tokens such as `route`, `routes`, `routeconfig`, and
  `webapiconfig` do not select unrelated legacy capabilities solely through
  old ASP.NET route-table naming conventions.
- framework/layer task tokens such as `jsp`, `page`, `pages`, `render`,
  `rendered`, `rendering`, and `renders` do not select unrelated legacy
  capabilities solely through JSP/page rendering vocabulary.
- framework/language task tokens such as `codeigniter` and `php` do not select
  unrelated legacy capabilities solely through CodeIgniter/PHP framework or
  language vocabulary.
- framework/language task tokens such as `cakephp` and `php` do not select
  unrelated legacy capabilities solely through CakePHP/PHP framework or
  language vocabulary.
- framework/language task tokens such as `symfony`, `xml`, `yaml`, `yml`, and
  `php` do not select unrelated legacy capabilities solely through Symfony/PHP
  framework or language vocabulary.
- framework/runtime task tokens such as `classic`, `asp`, `vbscript`, and
  `iis` do not select unrelated legacy capabilities solely through Classic
  ASP framework/runtime vocabulary.
- framework/language task tokens such as `coldfusion`, `cfm`, and `cfml` do
  not select unrelated legacy capabilities solely through ColdFusion/CFML
  vocabulary.
- framework/layer task tokens such as `bean`, `beans`, `mapping`, `mappings`,
  `mvc`, and `xml` do not select unrelated legacy capabilities solely through
  Spring XML MVC naming conventions.

## Profile Bootstrap Regression

```bash
bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/orchestrator-profile-bootstrap.test.ts apps/runner/test/context-builder.test.ts packages/shared/test/flow-registry.test.ts apps/runner/test/flow-registry.test.ts apps/api/test/workflow-request-routes.test.ts apps/api/test/report-sidecars.test.ts apps/api/test/knowledge-artifacts-route.test.ts apps/web/test/projects-rendering.test.ts
```

Must prove scanner/context/UI changes do not break profile bootstrap flow,
context selection, request creation, report generation, knowledge governance, or
web projection tests.

## Typecheck

```bash
bun run typecheck
```

Must pass.

## Full Suite

Run if scanner changes affect shared contracts or profile bootstrap behavior:

```bash
bun run test
```

## Default Eval Suite

Run when changing inventory-driven ContextPack selection or hybrid retrieval:

```bash
bun run eval
```

Must include both:

- `eval/scenarios/legacy-project-understanding.json` for handcrafted inventory
  ContextPack behavior, including a historical-inventory knowledge variant and
  scenario-level `contextQualityGates` aggregate irrelevant-context ratio
  checks across its variants.
- `eval/scenarios/legacy-project-understanding-e2e.json` for scanner-real
  inventory generation before ContextPack behavior.
- `eval/scenarios/legacy-project-understanding-polyglot-e2e.json` for
  Flask/Django/Rails/Laravel scanner-real route evidence, including Flask,
  Django include-mounted class-based view routes, Rails scope-mounted and
  static resources routes, and Laravel prefix-group-mounted plus
  resource-controller routes feeding handler/controller action -> explicit
  service/repository evidence.
- `eval/scenarios/legacy-project-understanding-spring-e2e.json` for
  Spring-style Java route annotation -> handler -> service/repository evidence
  and task-focused ContextPack selection across billing, customer, and reports
  domains.
- `eval/scenarios/legacy-project-understanding-springxml-e2e.json` for Spring
  XML MVC `SimpleUrlHandlerMapping` URL map and static URL bean name ->
  `Controller#handleRequest` -> service/repository evidence and task-focused
  ContextPack selection without leaking sibling XML-mapped controllers or
  sibling same-capability symbols.
- `eval/scenarios/legacy-project-understanding-aspnet-e2e.json` for
  ASP.NET-style C# attribute route -> action -> service/repository evidence and
  task-focused ContextPack selection across billing, customer, and reports
  domains.
- `eval/scenarios/legacy-project-understanding-aspnet-routetable-e2e.json` for
  old ASP.NET MVC/Web API `MapRoute(...)` / `MapHttpRoute(...)` route tables,
  static controller/action defaults, dynamic conventional route exclusion, and
  focused ContextPack selection.
- `eval/scenarios/legacy-project-understanding-jsp-e2e.json` for legacy JSP
  static page route evidence, bounded page source chunks, attached tests, and
  task-focused ContextPack selection without leaking unrelated page/test
  domains.
- `eval/scenarios/legacy-project-understanding-classic-asp-e2e.json` for
  Classic ASP static page route evidence, bounded page source chunks, attached
  tests, and task-focused ContextPack selection without leaking unrelated
  page/test domains.
- `eval/scenarios/legacy-project-understanding-coldfusion-e2e.json` for
  ColdFusion static page route evidence, bounded page source chunks, attached
  tests, and task-focused ContextPack selection without leaking unrelated
  page/test domains.
- `eval/scenarios/legacy-project-understanding-codeigniter-e2e.json` for
  legacy CodeIgniter static route config evidence, controller action graph
  edges, explicit PHP service/repository graph evidence, dynamic route pattern
  exclusion, attached tests, and task-focused ContextPack selection without
  leaking unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-cakephp-e2e.json` for legacy
  CakePHP static route config evidence, controller action graph edges,
  explicit PHP service/repository graph evidence, dynamic route pattern
  exclusion, attached tests, and task-focused ContextPack selection without
  leaking unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-yii-e2e.json` for legacy
  Yii/Yii2 static URL manager rule evidence, controller action graph edges,
  explicit PHP service/repository graph evidence, nonliteral rule exclusion,
  attached tests, and task-focused ContextPack selection without leaking
  unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-zend-e2e.json` for legacy Zend
  Framework 1 static `application.ini` router resource evidence, controller
  action graph edges, explicit PHP service/repository graph evidence, dynamic
  route value exclusion, attached tests, and task-focused ContextPack selection
  without leaking unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-symfony-yaml-e2e.json` for
  legacy Symfony YAML route config evidence, controller action graph edges,
  explicit PHP service/repository graph evidence, placeholder/import
  exclusion, attached tests, and task-focused ContextPack selection without
  leaking unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-symfony-xml-e2e.json` for
  legacy Symfony XML route config evidence, controller action graph edges,
  explicit PHP service/repository graph evidence, placeholder/import/service
  controller exclusion, attached tests, and task-focused ContextPack selection
  without leaking unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-slim-e2e.json` for legacy
  Slim/Silex static route calls, `Slim:Controller@action` graph evidence,
  explicit PHP service/repository graph evidence, non-route receiver and
  closure-handler exclusion, attached tests, and task-focused ContextPack
  selection without leaking unrelated route/test domains.
- `eval/scenarios/legacy-project-understanding-play-e2e.json` for Play
  Framework static `conf/routes` entries, Java controller method graph
  evidence, explicit service/repository graph evidence, static asset route
  exclusion, attached tests, and task-focused ContextPack selection without
  leaking unrelated Play route/test domains through framework vocabulary.
- `eval/scenarios/legacy-project-understanding-wcf-e2e.json` for WCF / .NET
  service contract -> implementation method -> service/repository evidence and
  task-focused ContextPack selection without leaking sibling WCF services.
- `eval/scenarios/legacy-project-understanding-asmx-e2e.json` for ASMX /
  .NET WebService -> method -> service/repository evidence and task-focused
  ContextPack selection without leaking sibling ASMX services.
- `eval/scenarios/legacy-project-understanding-go-e2e.json` for Go
  mux/http route -> handler -> service/repository evidence and task-focused
  ContextPack selection across billing, customer, and reports domains.
- `eval/scenarios/legacy-project-understanding-jaxrs-e2e.json` for JAX-RS /
  Jakarta REST route -> resource method -> service/repository evidence and
  task-focused ContextPack selection across billing, customer, and reports
  domains.
- `eval/scenarios/legacy-project-understanding-servlet-e2e.json` for Java
  Servlet `@WebServlet(...)` route -> servlet method -> service/repository
  evidence and task-focused ContextPack selection across billing, customer,
  and reports domains.
- `eval/scenarios/legacy-project-understanding-webxml-servlet-e2e.json` for
  Java `web.xml` servlet mapping -> servlet method -> service/repository
  evidence and task-focused ContextPack selection across billing, customer,
  and reports domains.
- `eval/scenarios/legacy-project-understanding-struts-e2e.json` for Struts2
  and Struts1 XML action mapping -> Action method -> service/repository
  evidence and task-focused ContextPack selection across billing, customer,
  and reports domains.
- `eval/scenarios/legacy-project-understanding-fastify-e2e.json` for Fastify
  same-file plugin registration prefixes, route -> handler -> explicit
  service/repository evidence, attached tests, raw inventory exclusion, and
  task-focused ContextPack selection across billing, customer, and reports
  domains.
- `eval/scenarios/legacy-project-understanding-fixturedir-e2e.json` for
  checked-in directory-backed fixture input under `eval/fixtures/`, merged with
  inline scenario files before scanner-real billing route/service/repository
  evidence, tests, source chunks, and selected-section gates are asserted.
- `eval/scenarios/legacy-project-understanding-directory-corpus-e2e.json` for
  a larger checked-in directory-backed old billing corpus with route/controller/
  service/repository/test layers, SQL schema/view/routine evidence, sibling
  customer domain leakage checks, filtered generated/vendor noise, and
  scanner-real ContextPack route/graph/domain/source-chunk assertions.
- `eval/scenarios/legacy-project-understanding-symfony-directory-corpus-e2e.json`
  for a second checked-in directory-backed old Symfony commerce corpus with
  YAML route config, billing/orders/customers PHP layers, SQL schema/routine
  evidence, tests, filtered vendor/tmp/cache noise, and section-local
  capability/domain/source-chunk/symbol/test assertions plus sibling-domain
  leakage checks.
- The checked-in directory-backed legacy corpora also require
  full source-RAG readiness coverage through `inventoryQualityGates`:
  `contentSha256`, `sourceChunkIndex`, and linked inventory-record coverage
  must all stay at `1`, so source chunk anchors remain usable for later
  cross-run retrieval/RAG work.
- Native `bun test` includes the ContextPack source chunk `contentSha256` and
  historical `sourceChunkIndex` tests, and those tests must keep asserting the
  real source-ref arrays outside Bun's mutating asymmetric matcher path.
- `eval/scenarios/legacy-project-understanding-rails-directory-corpus-e2e.json`
  for a third checked-in directory-backed old Rails commerce corpus with
  `config/routes.rb`, billing/orders/customers namespaced Ruby layers, SQL
  schema/routine evidence, tests, filtered vendor/tmp/log noise, sensitive
  credential-like config exclusion, source-RAG readiness gates, corpus diversity
  gates, and section-local sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-django-directory-corpus-e2e.json`
  for a fourth checked-in directory-backed old Django commerce corpus with
  project URLConf `include(...)` mounts, billing/orders/customers Python
  URLConf/view/service/repository layers, SQL schema/view/routine evidence,
  tests, filtered vendor/tmp/log noise, sensitive credential-like config
  exclusion, source-RAG readiness gates, corpus diversity gates, and
  section-local sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-laravel-directory-corpus-e2e.json`
  for a fifth checked-in directory-backed old Laravel commerce corpus with
  static `Route::controller(...)->prefix(...)->group(...)` route groups,
  billing/orders/customers PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, filtered vendor/tmp/log noise,
  sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-spring-directory-corpus-e2e.json`
  for a sixth checked-in directory-backed old Spring commerce corpus with
  static annotation routes, billing/orders/customers Java controller/service/
  repository layers, SQL schema/view/routine evidence, tests, filtered
  target/vendor/log noise, sensitive credential-like config exclusion,
  source-RAG readiness gates, corpus diversity gates, and section-local
  sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-aspnet-directory-corpus-e2e.json`
  for a seventh checked-in directory-backed old ASP.NET commerce corpus with
  static attribute routes, billing/orders/customers C# controller/service/
  repository layers, SQL schema/view/routine evidence, tests, filtered
  bin/obj/log noise, sensitive credential-like config exclusion,
  source-RAG readiness gates, corpus diversity gates, and section-local
  sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-go-directory-corpus-e2e.json`
  for an eighth checked-in directory-backed old Go commerce corpus with static
  mux/http routes, billing/orders/customers handler/service/repository layers,
  SQL schema/view/routine evidence, tests, filtered vendor/tmp/log noise,
  sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-struts-directory-corpus-e2e.json`
  for a ninth checked-in directory-backed old Struts commerce corpus with static
  Struts2 `struts.xml` package/action mappings, Struts1 `struts-config.xml`
  action mappings, billing/orders/customers Java action/service/repository
  layers, SQL schema/view/routine evidence, tests, filtered target/vendor/log
  noise, sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-jaxrs-directory-corpus-e2e.json`
  for a tenth checked-in directory-backed old JAX-RS commerce corpus with
  static `@ApplicationPath`, resource class `@Path`, and method-level HTTP/path
  annotations, billing/orders/customers Java resource/service/repository
  layers, SQL schema/view/routine evidence, tests, filtered target/vendor/log
  noise, sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks.
- `eval/scenarios/legacy-project-understanding-wcf-directory-corpus-e2e.json`
  for an eleventh checked-in directory-backed old WCF commerce corpus with
  static `.svc` `ServiceHost` directives, `ServiceContract` /
  `OperationContract` operations, billing/orders/customers C#
  implementation/manager/repository layers, SQL schema/view/routine evidence,
  tests, filtered bin/obj/log noise, sensitive credential-like config
  exclusion, source chunk hash/index readiness gates, corpus diversity gates,
  and section-local sibling-domain leakage checks for the WCF host, contract,
  implementation, and repository source chunks.
- `eval/scenarios/legacy-project-understanding-jaxws-directory-corpus-e2e.json`
  for a twelfth checked-in directory-backed old JAX-WS commerce corpus with
  static `@WebService` classes and `@WebMethod` operations, billing/orders/
  customers Java service/manager/repository layers, SQL schema/view/routine
  evidence, tests, filtered target/vendor/log noise, sensitive credential-like
  config exclusion, source chunk hash/index readiness gates, corpus diversity
  gates, and section-local sibling-domain leakage checks for the SOAP service,
  manager, and repository source chunks.
- `eval/scenarios/legacy-project-understanding-asmx-directory-corpus-e2e.json`
  for a thirteenth checked-in directory-backed old ASMX commerce corpus with
  old `.asmx` host files plus static `[WebService]` classes and `[WebMethod]`
  operations, billing/orders/customers C# service/manager/repository layers,
  SQL schema/view/routine evidence, tests, filtered bin/obj/log noise,
  sensitive credential-like config exclusion, source chunk hash/index
  readiness gates, corpus diversity gates, and section-local sibling-domain
  leakage checks for the ASMX service, manager, and repository source chunks.
- `eval/scenarios/legacy-project-understanding-webforms-directory-corpus-e2e.json`
  for a fourteenth checked-in directory-backed old ASP.NET Web Forms commerce
  corpus with static `.aspx` Page directives, `Inherits` code-behind classes,
  `Page_Load` handler mapping, billing/orders/customers C# page/service/
  repository layers, SQL schema/view/routine evidence, tests, filtered
  bin/obj/log noise, sensitive credential-like config exclusion, source-RAG
  readiness gates, corpus diversity gates, and section-local sibling-domain
  leakage checks for the page route, domain entities, SQL routine chunk,
  code-behind chunk, repository chunk, symbol section, and tests section.
- `eval/scenarios/legacy-project-understanding-codeigniter-directory-corpus-e2e.json`
  for a fifteenth checked-in directory-backed old CodeIgniter 2/3 commerce
  corpus with static `application/config/routes.php` assignments,
  billing/orders/customers PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, filtered vendor/tmp/log/cache noise,
  sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks for
  the route, handler source chunk, repository/table source chunk, SQL routine
  chunk, domain entities, symbol section, and tests section.
- `eval/scenarios/legacy-project-understanding-cakephp-directory-corpus-e2e.json`
  for a sixteenth checked-in directory-backed old CakePHP 2/3 commerce corpus
  with static `app/Config/routes.php` `Router::connect(...)` assignments,
  billing/orders/customers PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, filtered vendor/tmp/log noise,
  sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks for
  the route, handler source chunk, repository/table source chunk, SQL routine
  chunk, domain entities, symbol section, and tests section.
- `eval/scenarios/legacy-project-understanding-yii-directory-corpus-e2e.json`
  for a seventeenth checked-in directory-backed old Yii/Yii2 commerce corpus
  with static `config/web.php` URL manager rules,
  billing/orders/customers PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, filtered vendor/tmp/log noise,
  sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks for
  the route, handler source chunk, repository/table source chunk, SQL routine
  chunk, domain entities, symbol section, and tests section.
- `eval/scenarios/legacy-project-understanding-zend-directory-corpus-e2e.json`
  for an eighteenth checked-in directory-backed old Zend Framework 1 commerce
  corpus with static `application/configs/application.ini` router resources,
  billing/orders/customers PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, filtered vendor/tmp/log noise,
  sensitive credential-like config exclusion, source-RAG readiness gates,
  corpus diversity gates, and section-local sibling-domain leakage checks for
  the route, handler source chunk, repository/table source chunk, SQL routine
  chunk, domain entities, symbol section, and tests section.
- Scenario-level `inventoryQualityGates` in default legacy fixtures for
  measured scanner-to-context variant count, minimum symbol graph edge
  confidence, and minimum route-handler edge confidence. The Play, Slim/Silex,
  and polyglot old-project fixtures currently exercise these gates.
- Graph-bearing legacy fixtures without explicit `inventoryQualityGates` still
  receive default scenario-level confidence floors: symbol graph edge
  confidence must be at least `0.65`, and route-handler edge confidence must
  be at least `0.78`.
- Scanner-to-context legacy fixtures can declare source-RAG readiness floors in
  `inventoryQualityGates`, including source chunk `contentSha256` coverage,
  `sourceChunkIndex` coverage, and linked inventory-record coverage, so future
  real-corpus expansion cannot silently drop cross-run source retrieval anchors.
- Scanner-to-context legacy fixtures can declare corpus-readiness diversity
  floors in `inventoryQualityGates`, including distinct scanner-backed source
  file extensions, source path patterns, and inventory record kinds, so future
  real-corpus expansion cannot silently rely on a narrow fixture shape.
- `eval/scenarios-red/legacy-project-understanding-inventory-quality-gate.json`
  intentionally sets impossible inventory graph confidence floors, proving the
  eval command exits non-zero on scenario-level graph quality regressions even
  when the scanner-to-context variant itself succeeds.
- `eval/scenarios-red/legacy-project-understanding-source-rag-readiness-gate.json`
  intentionally sets an impossible source chunk index coverage floor, proving
  the eval command exits non-zero when source-RAG readiness metadata regresses.
- `eval/scenarios-red/legacy-project-understanding-corpus-coverage-gate.json`
  intentionally sets an impossible source extension diversity floor, proving
  the eval command exits non-zero when corpus-readiness diversity coverage
  regresses.
- `eval/scenarios-red/legacy-project-understanding-fixturedir-path-escape.json`
  intentionally points `fixtureDir.path` outside the repository root, proving
  the eval command exits non-zero during directory validation before the
  scanner-to-ContextPack path can run against an arbitrary filesystem tree.
- `eval/scenarios-red/legacy-project-understanding-fixturedir-not-directory.json`
  intentionally points `fixtureDir.path` at a checked-in file, proving the eval
  command exits non-zero during directory validation before file merging or
  scanner-to-ContextPack generation starts.
- `eval/scenarios-red/legacy-project-understanding-fixturedir-max-files.json`
  intentionally sets a too-low `fixtureDir.maxFiles`, proving the eval command
  exits non-zero when a checked-in directory-backed fixture exceeds its
  declared file-count budget.
- `eval/scenarios-red/legacy-project-understanding-fixturedir-max-file-bytes.json`
  intentionally sets a too-low `fixtureDir.maxFileBytes`, proving the eval
  command exits non-zero when a checked-in directory-backed fixture contains a
  regular file over its per-file byte budget.
- `eval/scenarios-red/legacy-project-understanding-fixturedir-max-total-bytes.json`
  intentionally sets a too-low `fixtureDir.maxTotalBytes`, proving the eval
  command exits non-zero when a checked-in directory-backed fixture exceeds
  its total byte budget.
- `eval/scenarios/legacy-project-understanding.json` mark-wrong correction
  variant now asserts section-local content and reason text for the suppressed
  capability and each hybrid fallback section, proving accepted corrections
  remain attached to source-level evidence instead of silently dropping the
  correction rationale.
- `eval/scenarios/legacy-project-understanding.json`
  `review-required-capability-wrong-ignored` variant proves an accepted
  capability-map correction with `reviewStatus='needs_review'` does not
  suppress the normal Orders capability, does not render as standalone
  `knowledge_*`, and does not attach correction source refs to selected
  inventory sections.
- `eval/scenarios/legacy-project-understanding.json`
  `accepted-correction-converged-label-superseded-signal` variant proves a
  current scan that already emits the governed label produces a structured
  `superseded` correction signal while keeping the old correction artifact out
  of selected current inventory sections through section-local
  `selectedSectionsInclude` gates.
- `eval/scenarios/legacy-project-understanding.json`
  `accepted-correction-ambiguous-converged-label-conflict-signal` variant
  proves a governed label that matches multiple current capability display
  labels produces a structured `conflict` correction signal that cites every
  matching current capability/source ref while selected current capability
  sections omit the old correction artifact/source refs/review text.
- `eval/scenarios/legacy-project-understanding-monolith-e2e.json`
  billing reconciliation relevance prefixes include graph-selected billing
  repository source chunks, so low-signal ratio checks treat intentional
  repository evidence as relevant instead of hiding a context-quality failure.
- `eval/scenarios-red/context-pack-section-content-bad-expectation.json`
  intentionally expects missing selected-section content, proving section-local
  `contentIncludes` checks fail when a selected section lacks required
  rationale text.
- `apps/runner/test/project-inventory.test.ts`
  `links Laravel constructor-injected interface fields to unique implementation
  methods` proves PHP `$this->field = $param` constructor assignments can
  resolve an injected interface to its single concrete implementation and emit
  source-ref-backed controller -> workflow -> repository graph edges without
  container or service-name inference.
- `apps/runner/test/project-inventory.test.ts`
  `does not link Laravel constructor-injected interface fields through
  ambiguous container bindings` proves PHP constructor injection stays
  unresolved when an interface has multiple scanned implementations, even when
  Laravel-style class-literal or string service bindings are present.
- `apps/runner/test/project-inventory.test.ts`
  `links NestJS parameter-property interface receivers to unique implementation
  methods` proves TypeScript constructor parameter properties create
  source-ref-backed receiver evidence from a decorated route handler through a
  unique implementation class and method.
- `apps/runner/test/project-inventory.test.ts`
  `links NestJS parameter-property concrete class receivers to service methods`
  proves TypeScript constructor parameter properties typed as concrete service
  classes continue through route -> controller method -> imported service class
  -> service method graph edges with source refs.
- `apps/runner/test/project-inventory.test.ts`
  `does not link NestJS parameter-property interfaces with ambiguous
  implementations` proves interface-typed parameter properties stay unresolved
  when multiple scanned implementation classes exist, even when a Nest module
  provider hint names one of them.
- `apps/runner/test/context-builder.test.ts`
  `selects historical source chunk index evidence from explicit source refs`
  proves a governed historical `ainp.project_inventory.v1` artifact can use
  `sourceChunkIndex` source-ref metadata to select a bounded source chunk from
  an explicit `file:...#Lx` task hint, without direct `sourceChunkRefs`,
  standalone knowledge rendering, raw inventory JSON, or unrelated chunks.
- `eval/scenarios/legacy-project-understanding.json`
  `historical-inventory-source-chunk-index-source-ref` locks the same path in
  the default eval corpus with section-local source-ref/reason/content
  expectations.
- `apps/runner/test/context-builder.test.ts`
  `prefers current inventory source chunks over historical duplicates for
  source-ref hints` proves explicit `file:...#Lx` tasks select the current-run
  bounded source chunk and suppress a historical inventory duplicate with the
  same chunk identity.
- `eval/scenarios/legacy-project-understanding.json`
  `current-source-ref-chunk-suppresses-historical-duplicate` locks that
  current-run precedence in the default eval corpus.
- `apps/runner/test/context-builder.test.ts`
  `uses historical source chunk index refs as metadata for matching current
  source chunks` proves a current-run bounded source chunk can inherit
  governed historical `sourceChunkIndex` source refs and linked symbol refs
  when the stable chunk location/identity matches, even if the current chunk's
  own source refs/range do not contain the explicit `file:...#Lx` hint.
  The selected section cites current-run inventory evidence first, renders as
  `code_probe`, carries pointed linked evidence, suppresses the historical
  duplicate, and keeps raw inventory JSON out of normal context.
- `eval/scenarios/legacy-project-understanding.json`
  `current-source-chunk-uses-historical-index-metadata` locks the same
  current-run + historical-index overlay path in the default eval corpus with
  section-local source-ref/reason/content expectations.
- `apps/runner/test/project-inventory.test.ts`
  `captures stable docs, package commands, modules, and safe exclusions` now
  also proves static SQL `CREATE TABLE user_audit_records` evidence emits a
  `table` domain entity, links it to the Users capability, and gives the SQL
  source chunk `domainEntityRefs`.
- `apps/runner/test/project-inventory.test.ts`
  `captures stable docs, package commands, modules, and safe exclusions` now
  also proves `ainp.source_chunk_index.v1` entries carry bounded
  `lexicalTokens`, compact token-only `searchText`, and combined
  `linkedRecordRefs` while preserving source refs and linked inventory refs
  and avoiding raw source snippet duplication.
- `apps/runner/test/project-inventory.test.ts` covers injected source chunk
  embedding provider vectors during inventory index generation, proving the
  provider receives only bounded lexical/search text and that invalid or
  failing providers fall back to the local deterministic embedding.
- `apps/runner/test/orchestrator-invoke-skill.test.ts` covers the same
  provider abstraction for task-time source chunk catalog `q` query vectors,
  proving injected valid vectors are passed to the catalog query, provider
  failures fall back to local vectors, query embedding models are forwarded,
  and exact linked-record fallback calls remain ref-only without `q`,
  `queryEmbedding`, or `queryEmbeddingModel`.
- `apps/api/test/projects-route.test.ts` covers model-compatible source chunk
  catalog vector ranking, proving same-dimension vectors from a different
  embedding model are excluded from vector-only lookup and receive no vector
  score in hybrid lexical/vector lookup.
- `apps/runner/test/project-inventory.test.ts`
  `source chunk content hashes stay stable when identical code shifts line
  numbers` now also proves source chunk index lexical metadata is derived from
  line-label-free bounded content/path rather than line-number labels.
- `apps/runner/test/context-builder.test.ts`
  `selects capability domain entities and pointed SQL source chunks without
  sibling leakage` proves business data-layer terms select Billing API table
  evidence and its bounded SQL source chunk while excluding a sibling customer
  table and raw inventory JSON.
- `apps/runner/test/project-inventory.test.ts`
  `links static SQL foreign keys between scanned table entities` proves static
  `.sql` `FOREIGN KEY ... REFERENCES ...` and inline `REFERENCES ...` clauses
  add source-ref backed relationship metadata between scanned table entities,
  preserve schema-qualified resolution, reject invalid/mismatched schema
  qualifiers, exclude unrelated sibling tables, and propagate the related table
  ids into source chunks and `sourceChunkIndex`.
- `apps/runner/test/context-builder.test.ts`
  `uses static SQL foreign-key relationships for table-focused ContextPack
  retrieval` proves a task that mentions the referenced and referencing
  business tables can select both table records and the FK schema chunk through
  relationship/index metadata, while excluding sibling data domains and raw
  `project-inventory.json`.
- `apps/runner/test/project-inventory.test.ts`
  `links static SQL joins between scanned table entities` proves static
  `FROM ... JOIN ...` SQL in source-like non-test files and `.sql` files adds
  source-ref backed join relationship metadata between scanned table entities,
  covers quoted and SQL Server bracketed schema/table identifiers, rejects
  dynamic schema/suffix-only/test-file false positives, and propagates both
  table ids into source chunks and `sourceChunkIndex`.
- `apps/runner/test/context-builder.test.ts`
  `uses static SQL join relationships for table-focused ContextPack retrieval`
  proves a task that matches one joined business table can select the directly
  joined table record plus bounded query chunk through relationship/index
  metadata, while excluding sibling data domains and raw
  `project-inventory.json`.
- `apps/runner/test/project-inventory.test.ts`
  `links static SQL views to scanned table dependencies` proves static `.sql`
  `CREATE VIEW` / `CREATE OR REPLACE VIEW` statements emit source-ref backed
  view domain entities, link resolvable static `FROM` / `JOIN` table
  dependencies, exclude dynamic schema expressions, and propagate view/table ids
  into source chunks and `sourceChunkIndex`.
- `apps/runner/test/context-builder.test.ts`
  `uses static SQL view dependency relationships for view-focused ContextPack
  retrieval` proves a task that matches a business view can select the view,
  directly dependent table records, and bounded view SQL chunk through
  relationship/index metadata, while excluding sibling data domains and raw
  `project-inventory.json`.
- `apps/runner/test/project-inventory.test.ts`
  `links static SQL routines to scanned table dependencies` proves static
  `.sql` `CREATE PROCEDURE` / `CREATE PROC` / `CREATE FUNCTION` statements emit
  source-ref backed routine domain entities, link resolvable static
  `UPDATE`, `INSERT INTO`, `FROM`, `JOIN`, `MERGE INTO`, and `DELETE FROM`
  table references, exclude dynamic schema/table SQL, and propagate
  routine/table ids into source chunks and `sourceChunkIndex`.
- `apps/runner/test/context-builder.test.ts`
  `uses static SQL routine dependency relationships for routine-focused
  ContextPack retrieval` proves a task that matches a business routine can
  select the routine, directly related table records, and bounded routine SQL
  chunk through relationship/index metadata, while excluding sibling data
  domains and raw `project-inventory.json`.
- `eval/scenarios/legacy-project-understanding.json`
  `capability-domain-entity-sql-source-chunk` locks the same capability /
  domain entity / SQL source chunk path in the default eval corpus.

## Known Follow-Up Verification

V1.2+ still needs a project-level evaluation set with real old projects. The
default eval suite now includes deterministic fixture coverage for legacy
inventory retrieval, including governed historical inventory knowledge reuse,
and runner-side latest prior inventory artifact discovery. It still does not
claim broad parser correctness, managed vector-index quality, external semantic
retrieval quality, or cross-run RAG recall.
