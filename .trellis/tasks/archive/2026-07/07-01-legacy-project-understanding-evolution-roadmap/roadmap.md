# Legacy Project Understanding Roadmap

## V1.1 - Calibration + Noise Reduction

Purpose: make the existing heuristic capability map less noisy and more useful
on real projects.

Deliverables:

- Additional route/framework detection patterns.
- Flask Blueprint decorator routes with static `url_prefix` handling and
  same-file static `register_blueprint(..., url_prefix=...)` handling, plus
  FastAPI `APIRouter(prefix=...)` and same-file static
  `include_router(..., prefix=...)` decorator routes.
- Flask static `add_url_rule(...)` registrations with simple function
  `view_func=some_view`, or MethodView registrations with
  `view_func=SomeView.as_view(...)` and static `methods=[...]`, resolved to
  function handlers or concrete class methods such as `SomeView.post`.
- Django URLConf routes mounted through static `include("app.urls")` calls
  and static tuple includes such as
  `include(("app.urls", "app"), namespace="app")` when the target `urls.py`
  file is present in the scanned repository.
- Django function view routes using `views.some_view` or directly imported
  `some_view` handlers, resolved to sibling `views.py` function symbols.
- Django class-based view routes using static `views.SomeView.as_view()` or
  directly imported `SomeView.as_view()` calls, resolved to sibling `views.py`
  class symbols.
- Laravel routes mounted through same-file static
  `Route::prefix(...)->group(...)` and
  `Route::middleware(...)->prefix(...)->group(...)` blocks.
- Laravel routes inside static controller groups such as
  `Route::controller(BillingController::class)->group(...)`, where nested
  quoted string actions resolve to `BillingController@action` handler evidence
  and continue through the existing controller/service graph.
- Laravel static invokable controller routes from `Route::get(...,
  SomeController::class)`, resolved to conventional `__invoke` controller
  methods.
- Laravel RESTful resource controller routes from static `Route::resource(...)`
  and `Route::apiResource(...)` declarations, including static `only()` /
  `except()` action filters and existing static prefix groups.
- Rails routes mounted through same-file static `scope "/prefix" do` blocks.
- Rails routes mounted through same-file static `namespace :name do` blocks,
  treated as route path prefixes only.
- Rails RESTful routes from static `resources :name` declarations, including
  static `only:` / `except:` action filters and existing static scope prefixes.
- Rails singular RESTful routes from static `resource :name` declarations,
  including static `only:` / `except:` action filters, existing static scope
  prefixes, and conventional plural controller targets.
- Rails legacy `match "/path", to: "...#...", via: ...` routes, including
  static symbol, string, array, and `%i[...]` `via` method evidence under
  existing static scope prefixes.
- Rails legacy hashrocket route targets such as
  `get "/path" => "controller#action"` and
  `match "/path" => "controller#action", via: :post`, when the route path,
  target, and method evidence are static.
- Rails static `root to: "...#..."` and `root "...#..."` routes, mapped to
  `GET /` or an existing static scope prefix without inferring redirects,
  dynamic targets, block routes, or runtime routing.
- Go Gorilla mux-style static `HandleFunc(...).Methods(...)` route chains,
  including quoted methods and `http.Method*` constants.
- Fastify same-file static `register(plugin, { prefix: "..." })` plugin
  routes, combining the register prefix with shorthand and object-literal
  route declarations inside the registered plugin function.
- NestJS-style TypeScript routes with class-level `@Controller(...)` prefixes
  and method-level HTTP decorators such as `@Get(...)` / `@Post(...)`.
- Next.js Pages API routes from static `pages/api/**` files with default
  exports, including default-exported handler aliases, imported default
  handlers, CommonJS `module.exports` handlers, and default-handler re-exports
  from thin route files. Static `req.method` checks and `switch (req.method)`
  branches calibrate broad `ANY` routes into concrete HTTP methods when the
  route file provides that evidence.
- Spring XML MVC routes from static `SimpleUrlHandlerMapping` mappings using
  `<prop key="/...">beanId</prop>` or `<entry key="/..." value-ref="beanId" />`
  with same-file bean id to controller class resolution, plus static URL bean
  names such as `<bean name="/path.htm" class="...Controller" />`.
- Play Framework routes from static `conf/routes` entries with literal HTTP
  methods, literal paths, and Java controller targets such as
  `controllers.BillingController.approveRefund(...)`, mapped to
  `BillingController#approveRefund`.
- JAX-RS / Jakarta REST Java resource routes with application-level
  `@ApplicationPath(...)`, class-level `@Path(...)` prefixes, and method-level
  `@GET` / `@POST` plus `@Path(...)` annotations.
- JAX-WS / SOAP Java service operations with static `@WebService(...)`
  class annotations and non-excluded `@WebMethod(...)` method annotations.
- WCF / .NET service operations with static `[ServiceContract(...)]`
  type attributes and `[OperationContract(...)]` method attributes.
- ASMX / .NET WebService operations with static `[WebService(...)]`
  class attributes and `[WebMethod(...)]` method attributes.
- ASP.NET Web Forms pages from static `.aspx` Page directives with
  `Inherits="..."`, deriving the route from the page path and mapping to the
  code-behind `Page_Load` handler when present.
- Old ASP.NET MVC/Web API route tables from static `MapRoute(...)` and
  `MapHttpRoute(...)` calls when `url` / `routeTemplate` plus
  `controller`/`action` defaults are all string-literal evidence.
- Java Servlet routes from static `@WebServlet(...)` annotations, including
  single string paths, `urlPatterns = "..."`, and multiple
  `urlPatterns = { ... }` paths mapped to `doGet` / `doPost` style handlers.
- Java Servlet routes from static `WEB-INF/web.xml` deployment descriptors,
  including servlet-name / servlet-class / url-pattern mappings resolved to
  implemented `doGet` / `doPost` style handlers.
- Legacy JSP pages from static `.jsp` file paths under web roots such as
  `src/main/webapp`, deriving page route entrypoints without inferring servlet
  container behavior.
- Classic ASP pages from static `.asp` file paths under web roots such as
  `web`, deriving page route entrypoints without inferring server-side
  includes, form actions, COM objects, ADO calls, IIS mappings, or runtime
  page dispatch behavior.
- ColdFusion pages from static `.cfm` / `.cfml` file paths under web roots
  such as `wwwroot`, deriving page route entrypoints without inferring
  `cfinclude`, `cfform`, CFC components, datasources, application mappings,
  scheduled tasks, or runtime page dispatch behavior.
- CodeIgniter 2/3 routes from static `application/config/routes.php`
  assignments such as `$route['billing/statements'] = 'billing/statements'`,
  deriving route entrypoints only when both route path and controller/method
  target are literal evidence.
- CakePHP 2/3 routes from static `Router::connect(...)` assignments in
  `app/Config/routes.php` or `config/routes.php`, deriving route entrypoints
  only when route path, controller, and action are literal evidence.
- Yii/Yii2 routes from static URL manager rules in common PHP config paths
  such as `config/web.php`, `config/main.php`, `frontend/config/main.php`,
  `backend/config/main.php`, and `protected/config/main.php`, deriving route
  entrypoints only when string-map rules or array-style `pattern` / `route`
  values are literal evidence.
- Zend Framework 1 routes from static `application.ini` router resources such
  as `resources.router.routes.billing.route = "/billing/statements"`, deriving
  route entrypoints only when route path, controller, and action defaults are
  literal evidence.
- Drupal 7 routes from static `.module` `hook_menu()` definitions such as
  `$items['billing/refunds/%/approve'] = array(...)`, deriving route
  entrypoints only when the menu path, `page callback` function, or
  `drupal_get_form` first `page arguments` form function are literal evidence.
- WordPress plugin routes from static `add_action(...)` hooks such as
  `admin_post_billing_refund_approve` and `wp_ajax_billing_refund_status`,
  deriving route entrypoints only when the hook name and function or static
  class callback are literal evidence.
- WordPress REST routes from static `register_rest_route(...)` calls, deriving
  route entrypoints only when namespace, route path, function or static class
  callback, and methods are static literal or known `WP_REST_Server::*`
  constant evidence.
- Slim/Silex-style PHP routes from static `$app->get/post/...(...)` calls when
  the receiver is a conventional route app/router variable and the handler is
  a literal controller callable such as `[BillingController::class,
  "approveRefund"]` or `"BillingController:approveRefund"`.
- Sinatra/Rack-style Ruby block routes from static `get/post/... "/path" do`
  declarations in files that are clearly Sinatra-like, deriving bounded
  source-ref backed route entrypoints without inventing handler symbols for
  inline blocks.
- Symfony YAML routes from static `app/config/routing.yml` or
  `config/routes.yaml` route blocks, deriving route entrypoints only when
  route path/pattern and controller target are literal evidence.
- Symfony XML routes from static `app/config/routing.xml` or
  `config/routes.xml` `<route>` elements, deriving route entrypoints only when
  route path/pattern and controller target are literal evidence.
- Struts routes from static XML action mappings, including Struts2
  `struts.xml` package namespace plus action name/class/method attributes and
  Struts1 `struts-config.xml` action path/type attributes.
- Script-to-capability filtering.
- Better route segment selection and capability labels.
- Conservative confidence tweaks.
- Fixture tests that encode real-world framework examples.

## V1.2 - AST / Symbol Graph

Purpose: replace the most fragile regex extraction with parser-backed evidence.

Candidate approaches:

1. Existing TypeScript compiler API for TS/JS first. Selected for the first
   slice because the repository already uses TypeScript for tooling and it does
   not require adding a new dependency.
2. ast-grep CLI/library for multi-language structural patterns.
3. tree-sitter for broad language coverage.

Target output:

- `symbolGraph`
- `imports`
- `exports`
- rough `route -> handler -> service` links

First-slice implementation:

- optional dynamic TypeScript compiler API import;
- safe fallback to heuristic extraction when the parser is unavailable;
- additive inventory fields so existing profile bootstrap consumers keep
  working.
- import/export-backed route-handler resolution for TS/JS route files where a
  route callback is imported from a local controller/module; graph edges cite
  the route line, import line, and resolved handler symbol.
- import/export-backed symbol-reference resolution for TS/JS controller/service
  calls where a handler constructs or uses a locally imported service; graph
  edges cite the call site, import line, and resolved service/export symbol
  instead of falling back to same-file names first.
- Next.js Pages API default exports now produce route -> default handler edges
  for `pages/api/**` files, including `export default handler` aliases, and
  can continue through imported service calls in the same TS/JS graph. Thin
  Pages API route files that re-export a default handler from another module
  now have regression coverage proving the route edge follows the re-export to
  the external handler and service.
- Import-backed Pages API default exports such as `import handler from ...;
  export default handler;` now resolve as re-export evidence, so the route
  edge follows the imported default handler symbol and service instead of
  stopping at the route file.
- CommonJS Pages API default exports such as `const handler = require(...);
  module.exports = handler;` now resolve as import-backed default re-export
  evidence, and CommonJS target handler modules shaped as
  `module.exports = function handler(...) { ... }` produce real handler
  symbols for the graph.
- Next.js Pages API static method branches now produce method-specific
  entrypoints while retaining route -> default handler -> service graph edges,
  reducing `ANY` noise without inferring dynamic runtime dispatch.
- NestJS-style TypeScript controller decorators now produce route -> class
  method graph edges that cite controller decorator, method decorator, and the
  actual method symbol line.
- conservative Java/C#/PHP/Ruby/Python/Go symbol-reference extraction for
  explicit constructed receivers such as `new BillingService()` or
  `$service = new CustomerService()` / `service = ReportService.new` /
  `service = BillingService()` / `service := NewBillingService()` /
  `repo := &BillingRepository{}`, producing source-ref backed controller or
  handler -> service -> repository class/type/method edges without inferring
  DI, IoC containers, interfaces, factories, imports, dataflow, or runtime
  wiring.
- Import-backed heuristic constructed receivers normalize local aliases to the
  resolved class/type symbol before graph edges are emitted. For example,
  `from services.billing_service import BillingService as BillingSvc` followed
  by `service = BillingSvc()` now produces `uses BillingService` and
  `calls BillingService.reconcile` graph evidence with import, constructor,
  call-site, and target source refs, rather than exposing the local alias as
  the canonical capability evidence.
- Rails/Ruby `require_dependency` statements now create import evidence for
  uniquely resolved scanned files under Rails-style `app/` or `lib/` load paths.
  This lets `service = BillingService.new` choose the source-backed
  `app/services/billing_service.rb` class instead of a same-named shadow class,
  without executing Ruby or inferring arbitrary Rails autoload constants.
- Rails/Ruby qualified class declarations such as
  `class Billing::RefundService` now produce the leaf class symbol
  `RefundService` and no longer let the generic class matcher emit a misleading
  `Billing` class. Combined with explicit `require_dependency` evidence,
  namespaced constructed receivers like `Billing::RefundService.new` can link to
  the correct service/repository class and method symbols.
- Rails/Ruby constructed receivers now accept explicit global namespace
  constants such as `::Billing::RefundService.new` and normalize them to the
  same leaf class symbol. This keeps old Rails code inside nested modules
  source-backed without adding runtime constant lookup or broad autoload
  inference.
- Rails/Ruby explicit route targets with controller paths, such as
  `to: "admin/billing#approve_refund"`, now preserve the literal controller
  path in handler evidence and resolve it to
  `app/controllers/admin/billing_controller.rb` action symbols. This is bounded
  to explicit `to:` route targets and does not infer Rails controller
  namespaces from route scopes or runtime autoloading.
- Flask/Python static `add_url_rule(...)` registrations now produce concrete
  function-view handlers such as `approve_refund` and MethodView handlers such
  as `BillingRefundView.post` from static `view_func` / `methods=[...]`
  evidence, so route-handler edges can point at the view function or method and
  continue through explicit constructed service/repository receivers. This does
  not execute Flask route maps or infer dynamic `view_func` values.
- Python namespace imports such as `import services.billing_service as
  billing_service` followed by `service = billing_service.BillingService()`
  are now also import-backed receiver evidence, preserving canonical
  `BillingService` labels and target paths without executing imports or
  following dynamic Python import machinery.
- Unaliased multi-segment Python namespace imports such as
  `import services.billing_service` followed by
  `service = services.billing_service.BillingService()` now resolve through
  exact static import specifier evidence, so shared top-level packages do not
  cause sibling-module receiver links.
- Python relative imports such as
  `from .services.billing_service import BillingService` and
  `from ..repositories.billing_repository import BillingRepository` are now
  covered by the Flask/Python service graph regression and the scanner-to-
  ContextPack polyglot e2e fixture, proving the existing static import module
  path resolver preserves canonical service/repository graph labels for
  package-relative old Python projects.
- Python package-relative module imports such as
  `from .services import billing_service` followed by
  `service = billing_service.BillingService()` and
  `from ..repositories import billing_repository` followed by
  `repository = billing_repository.BillingRepository()` now create namespace
  import evidence for the imported module file, so route -> handler -> service
  -> repository chains stay source-backed without relying on loose class-name
  matching.
- Python package re-exports through `__init__.py`, such as
  `from .services import BillingService` paired with
  `services/__init__.py` re-exporting `BillingService` from
  `billing_service.py`, now resolve through bounded static import evidence.
  The graph cites the importing file, re-export file, constructor/call-site,
  and target symbol refs, avoiding same-named shadow modules.
- Python package namespace imports paired with `__init__.py` re-exports, such
  as `from . import services` followed by
  `services.BillingService()` or `from legacy_billing import services`
  followed by `services.BillingService()`, now have scanner and scanner-to-
  ContextPack eval coverage for the same canonical route -> handler ->
  service -> repository graph path.
- Conservative Python star imports from local modules/packages, such as
  `from .services import *` where `services/__init__.py` statically re-exports
  `BillingService`, now expand only when the target scanned `.py` file exposes
  bounded public static names. This keeps route -> handler -> service ->
  repository evidence source-backed for old Python projects without executing
  imports or treating broad unresolved star imports as local evidence.
- Python star imports that expose local module namespaces, such as
  `from .services import *` where `services/__init__.py` contains
  `from . import billing_service`, now emit namespace import evidence for the
  concrete local module file. Calls like `billing_service.BillingService()`
  can therefore follow the same canonical route -> handler -> service graph
  path without falling back to same-named shadow modules.
- Python star import expansion honors simple static `__all__` list/tuple
  declarations in scanned local modules/packages, including multi-line string
  literal collections. Names outside `__all__` are not exposed through star
  imports, while dynamic/unparseable `__all__` remains unsupported instead of
  being guessed.
- PHP fully qualified constructed receivers such as
  `new \App\Services\BillingService()` now resolve directly to the matching
  scanned class path before graph edges are emitted. This keeps Laravel/Symfony
  style service/repository chains canonical even when the file does not use a
  `use` import and same-named shadow classes exist elsewhere in the project.
- PHP grouped `use` imports such as
  `use App\Repositories\{BillingRepository as BillingRepo};`, including the
  common multi-line group form, now expand into ordinary import evidence,
  preserving alias normalization for constructed receivers like
  `new BillingRepo()` and keeping downstream repository graph edges canonical.
- Laravel/PHP service-locator assignments that use static class literals, such
  as `app(\App\Services\BillingService::class)`, `resolve(...)`,
  `\App::make(...)`, and `app()->make(...)`, now create conservative receiver
  evidence for the assigned variable. The scanner resolves those literals
  through existing FQCN/import/alias logic and then follows explicit method
  calls, while string service names and runtime container bindings remain
  unsupported.
- Laravel/PHP static controller groups such as
  `Route::controller(BillingController::class)->prefix(...)->group(...)` now
  resolve nested quoted string actions to `BillingController@action` handler
  evidence. The route-handler edge cites both the group and route lines, then
  follows the existing controller -> service/repository chain without
  inspecting Laravel runtime routes or dynamic controller values.
- Laravel/PHP static factory assignments with explicit class receivers, such as
  `\App\Services\BillingService::make()` and `BillingRepo::instance()`, now
  create the same conservative receiver evidence for a bounded factory-method
  allowlist (`build`, `create`, `factory`, `getInstance`, `instance`, `make`).
  The Laravel `App` facade is excluded from this path so service-locator class
  literal evidence continues to use the service-locator resolver, not factory
  inference.
- JAX-RS / Jakarta REST Java resource annotations now produce route -> method
  graph edges for static class-level `@Path(...)` prefixes combined with
  method-level HTTP verb and path annotations, reusing the conservative Java
  symbol-reference chain for explicit constructed service/repository fields.
- JAX-WS / SOAP Java service annotations now produce route -> method graph
  edges for static `@WebService(...)` classes and non-excluded
  `@WebMethod(...)` operations, reusing the conservative Java
  symbol-reference chain for explicit constructed service/repository fields.
- Play Framework `conf/routes` files now produce route ->
  `Controller#action` graph edges for static Java controller targets such as
  `controllers.BillingController.approveRefund(...)`, reusing the conservative
  Java explicit constructed service/repository symbol-reference chain while
  skipping wildcard/static-asset routes and dynamic runtime router behavior.
- WCF / .NET service contract annotations now produce route -> method graph
  edges for static `[ServiceContract(...)]` interfaces or classes and
  `[OperationContract(...)]` methods. Interface contracts resolve to a unique
  static implementation class when one is present, then reuse the conservative
  C# explicit constructed service/repository symbol-reference chain.
- ASMX / .NET WebService annotations now produce route -> method graph edges
  for static `[WebService(...)]` classes and `[WebMethod(...)]` methods,
  reusing the conservative C# explicit constructed service/repository
  symbol-reference chain.
- ASP.NET Web Forms `.aspx` Page directives now produce route ->
  `PageClass#Page_Load` graph edges from static page-file routes and
  `Inherits="..."` code-behind classes, reusing the conservative C# explicit
  constructed service/repository symbol-reference chain.
- Old ASP.NET MVC/Web API route tables now produce route ->
  `Controller#Action` graph edges for static `MapRoute(...)` /
  `MapHttpRoute(...)` calls with literal route paths and literal
  controller/action defaults, while skipping broad conventional patterns such
  as `{controller}/{action}/{id}`.
- Java Servlet `@WebServlet(...)` annotations now produce route -> method graph
  edges for static servlet URL patterns mapped to `doGet` / `doPost` /
  `doPut` / `doDelete` style handler methods, reusing the conservative Java
  symbol-reference chain for explicit constructed service/repository fields.
- Java Servlet `web.xml` deployment descriptor mappings now produce route ->
  method graph edges for static servlet-class/url-pattern mappings by
  resolving the target Servlet class and implemented `doGet` / `doPost` style
  handler methods, reusing the conservative Java symbol-reference chain.
- Legacy JSP `.jsp` pages now produce source-ref backed static page route
  entrypoints derived from the page path, while relying on bounded source
  chunks for page evidence instead of inventing controller or scriptlet call
  graph edges.
- Classic ASP `.asp` pages now produce source-ref backed static page route
  entrypoints derived from the page path, while relying on bounded source
  chunks for page evidence instead of inventing COM, ADO, include, or
  VBScript call graph edges.
- ColdFusion `.cfm` / `.cfml` pages now produce source-ref backed static page
  route entrypoints derived from the page path, while relying on bounded source
  chunks for page evidence instead of inventing CFC, `cfinclude`, datasource,
  or CFML call graph edges.
- CodeIgniter static `application/config/routes.php` assignments now produce
  source-ref backed route entrypoints and route -> controller action graph
  edges for literal `controller/method` targets, reusing the conservative PHP
  explicit constructed service/repository chain without expanding dynamic route
  patterns, defaults, or callbacks.
- CakePHP static `Router::connect(...)` assignments now produce source-ref
  backed route entrypoints and route -> controller action graph edges for
  literal controller/action array targets, reusing the conservative PHP
  explicit constructed service/repository chain without expanding dynamic route
  patterns, plugin routing, prefixes, named params, passed args, callbacks, or
  runtime route inspection.
- Yii/Yii2 static URL manager rules now produce source-ref backed route
  entrypoints and route -> controller action graph edges for literal
  string-map rules and literal `pattern` / `route` array rules, reusing the
  conservative PHP explicit constructed service/repository chain without
  inferring Yii modules, URL rules, callbacks, imports, DI/container wiring, or
  runtime route inspection.
- Zend Framework 1 static `application.ini` router resources now produce
  source-ref backed route entrypoints and route -> controller action graph
  edges for literal route/controller/action defaults, reusing the conservative
  PHP explicit constructed service/repository chain without inferring dynamic
  routes, custom route classes, plugins, modules beyond literal class/path
  evidence, front-controller wiring, DI/container wiring, or runtime route
  inspection.
- Drupal 7 static `.module` `hook_menu()` definitions now produce source-ref
  backed route entrypoints and route -> page callback function graph edges for
  literal menu paths and literal `page callback` values. Literal
  `drupal_get_form` callbacks now resolve through the first literal
  `page arguments` form function, reusing the conservative PHP explicit
  constructed service/repository chain without inferring dynamic form builders,
  menu loaders, access callbacks, includes, module weights, DI/container
  wiring, or Drupal runtime routing.
- WordPress static `add_action(...)` hooks now produce source-ref backed route
  entrypoints for literal `admin_post_*`, `admin_post_nopriv_*`, `wp_ajax_*`,
  and `wp_ajax_nopriv_*` hooks. These map to `WordPress:<callback>` function
  graph evidence or `WordPress:<Class>@<method>` class method evidence and
  reuse the conservative PHP explicit constructed service/repository chain
  without inferring instance callbacks, shortcodes, includes, plugin boot
  order, nonce/capability checks, DI/container wiring, or WordPress runtime
  dispatch.
- WordPress static `register_rest_route(...)` calls now produce source-ref
  backed REST route entrypoints such as
  `/wp-json/billing/v1/refunds/(?P<id>\d+)/approve` when namespace, route
  path, callback, and method values are static evidence. Literal function
  callbacks map to `WordPress:<callback>` graph evidence, while static class
  callbacks such as `array(BillingController::class, "approve")` map to
  `WordPress:BillingController@approve` graph evidence. Both continue through
  explicit PHP constructed service/repository calls while dynamic namespace,
  route path, callback, instance callbacks, permission callbacks, includes,
  plugin boot order, DI/container wiring, and WordPress runtime dispatch remain
  out of scope.
- Slim/Silex-style static `$app` / `$router` route calls now produce source-ref
  backed route entrypoints and route -> controller action graph edges for
  literal controller callables, reusing the conservative PHP explicit
  constructed service/repository chain while skipping closures, arbitrary
  object method calls, wildcard routes, DI/container wiring, and runtime route
  inspection.
- Sinatra-style Ruby block routes now produce source-ref backed route
  entrypoints for static `get/post/... "/path" do` declarations only when the
  file has explicit Sinatra evidence such as `require "sinatra/base"` or
  `< Sinatra::Base`. Bounded block source refs are preserved for ContextPack
  selection, while dynamic paths, wildcard routes, interpolated paths, Rack
  mounts, runtime dispatch, and inline-block handler inference remain out of
  scope.
- Symfony YAML static route blocks now produce source-ref backed route
  entrypoints and route -> controller action graph edges for literal bundle or
  FQCN controller targets, reusing the conservative PHP explicit constructed
  service/repository chain without expanding placeholders, imports,
  service-container routes, annotations, bundle config imports, callbacks,
  DI/container wiring, or runtime route inspection.
- Symfony XML static `<route>` elements now produce source-ref backed route
  entrypoints and route -> controller action graph edges for literal bundle or
  FQCN controller targets, reusing the conservative PHP explicit constructed
  service/repository chain without expanding placeholders, imports,
  service-container routes, annotations, bundle config imports, callbacks,
  DI/container wiring, or runtime route inspection.
- Struts XML action mappings now produce route -> Action method graph edges
  for static Struts2 package/action declarations and Struts1 action mappings,
  reusing the conservative Java symbol-reference chain for explicit constructed
  service/repository fields.
- Spring XML MVC `SimpleUrlHandlerMapping` blocks now produce route ->
  `Controller#handleRequest` graph edges for static XML URL maps, reusing the
  conservative Java explicit constructed service/repository symbol-reference
  chain.
- Spring XML MVC URL bean names now produce route -> `Controller#handleRequest`
  graph edges for static `/...` bean `name` or `id` values, without inferring
  runtime default handler mappings beyond the static XML evidence.

Remaining V1.2 decisions: whether broader non-TS projects should use ast-grep,
tree-sitter, or language-specific lightweight parsers, and how far to take DI,
IoC/container, interface, factory, and cross-package chains without a full type
checker.

## V1.3 - Task-Time Retrieval

Purpose: make ContextPack select relevant capability/symbol/test/hotspot
evidence for a specific task.

Target behavior:

- task brief keyword/domain matching against capability map;
- selected capability evidence appears in ContextPack manifest;
- accepted profile/capability knowledge remains governed by trust/freshness;
- fallback retrieval hints when no capability matches.

First-slice implementation:

- parse current-run `project-inventory.json` input artifacts;
- parse governed historical inventory knowledge artifacts that embed
  `ainp.project_inventory.v1` content;
- automatically discover the latest prior per-run `project-inventory.json`
  artifact when the current invocation has no inventory input;
- turn task-matched capability map evidence into `code_probe` ContextPack
  sections;
- include attached symbols, test surfaces, and hotspots for matched
  capabilities;
- narrow multi-entrypoint capability evidence to the task-focused route and
  symbolGraph-reachable handler/service/repository chain when graph evidence
  exists, so same-domain sibling routes are not injected just because the
  capability label matched;
- when a multi-entrypoint capability has graph-reachable symbols for the
  selected entrypoint, keep those graph-focused symbols and same-file class
  symbols instead of merging sibling text-matched symbols back into the
  ContextPack section;
- use graph-reachable symbol text while choosing among same-capability
  entrypoints, so a task term that appears only deeper in the handler -> service
  chain can focus the correct route instead of selecting sibling REST actions
  that share only the broad route noun;
- scanner-to-ContextPack eval now includes an old Next Pages API fixture,
  proving a task-focused Pages API route can select its route, handler,
  imported service, source chunks, and tests without selecting sibling domains.
  A second fixture covers a thin Pages API route file that only re-exports the
  default handler from another module. The invoice fixture now also proves
  static Pages API method evidence flows into task-time ContextPack selection
  as `POST /api/legacy-invoices/[id]`. A renewal fixture covers imported
  default handler evidence flowing into task-time ContextPack selection. A
  usage fixture covers CommonJS `require` / `module.exports` route-handler
  evidence flowing into task-time ContextPack selection;
- filter generic tokens such as `api` and `test` so unrelated capabilities do
  not enter context solely through framework vocabulary.

Remaining V1.3 decisions: how to evaluate irrelevant-context ratio on real
legacy projects and when to promote repeated historical inventory reuse into
governed project knowledge.

## V1.4 - Visualization + Human Correction

Purpose: let humans correct the map instead of treating heuristic output as
truth.

Target behavior:

- project UI displays capabilities, entrypoints, tests, and hotspots;
- user can accept, rename, merge, hide, or mark wrong;
- accepted corrections produce reviewable knowledge/correction artifacts;
- future scans can compare heuristic output against accepted corrections.

First-slice implementation:

- project page renders a compact capability map from the latest loaded
  profile-bootstrap inventory artifact;
- capability rows expose confidence plus entrypoint/symbol/test/hotspot
  evidence;
- accept, rename, merge, and mark-wrong actions write draft governed knowledge
  artifacts rather than accepted knowledge.
- accepted, non-review-required capability-map corrections can now influence
  later inventory-driven ContextPack selection: rename/merge metadata extends
  capability matching and annotates the selected `code_probe`, while mark-wrong
  suppresses the heuristic capability and keeps source-level inventory evidence
  available through hybrid retrieval.
- source-level fallback evidence selected after an accepted mark-wrong
  correction now carries the correction source refs and review text, so later
  ContextPack audits can explain that the capability grouping was suppressed
  while the underlying code evidence remained usable.
- project-page capability rows now compare the current scan output with
  persisted capability correction artifacts, so a future inventory can show
  when a heuristic capability has already been confirmed, renamed, merged, or
  marked wrong by governance.
- project-page comparison treats accepted corrections with `reviewStatus='none'`
  the same as corrections without a review-required status, matching the
  ContextPack builder's governance semantics and preventing newer draft
  corrections from hiding an already-governed correction.
- default eval coverage now includes accepted rename and merge correction
  variants where fulfillment/commerce tasks select the corrected or merged
  Orders capability through inventory-backed `code_probe` evidence while the
  correction artifact remains only a source ref, not a standalone
  `knowledge_*` section.
- ContextPack eval selected-section checks now cover content and reason text,
  and the accepted mark-wrong correction variant proves the suppressed
  capability plus hybrid fallback sections explicitly render the source-level
  fallback rationale and accepted correction review text.
- The deterministic eval now also covers review-required rename, merge, and
  mark-wrong corrections, proving unreviewed corrections do not match corrected
  labels or merge targets, do not suppress normal capability evidence, do not
  render as standalone knowledge, and do not leak correction source refs into
  selected inventory sections.
- ContextPack now emits a stale review signal when an accepted,
  non-review-required correction points to a capability that is missing from
  the current inventory. This gives future scans a durable correction drift
  signal without applying stale corrections to unrelated capabilities.
- The stale correction signal now also fires when the current inventory parses
  successfully but contains no capabilities, using that empty inventory artifact
  as current evidence instead of skipping drift detection.
- When the missing correction is a rename or merge and the current inventory
  already has a capability whose display label matches the corrected label or
  merge target, ContextPack emits a `superseded` review signal instead. This
  records that the heuristic scan appears to have converged on the governed
  label while keeping the old correction out of current capability evidence.
- Eval harness calibration-signal gates now assert the drift signal's kind,
  severity, recommended action, message text, subject refs, and evidence refs,
  so correction drift coverage cannot pass merely because some unrelated signal
  was emitted.
- Task detail context-governance UI now renders ContextPack calibration/review
  signals as read-only audit evidence, including kind, severity, recommended
  action, subject refs, and evidence refs for stale correction drift.

Remaining V1.4 decisions: bulk review workflows, richer merge UX beyond
prompt-based target entry, and richer correction drift workflows beyond the
read-only task-detail audit panel, report sidecars, and project-page row
comparison.

## V2 - Hybrid Retrieval / RAG

Purpose: add semantic search after deterministic evidence contracts stabilize.

Target behavior:

- BM25 + optional embedding retrieval over source chunks and capability graph;
- retrieval result cites graph/source refs;
- RAG augments capability map, not replaces it;
- evaluation set measures answer support and irrelevant context.

First-slice implementation:

- deterministic BM25-style lexical retrieval over current-run inventory
  entrypoints, symbols, tests, hotspots, and symbol graph edges;
- symbol graph edge labels are first-class hybrid documents, allowing
  call-site evidence to be selected even when connected symbols do not contain
  the task terms;
- hybrid matches become source-ref backed `code_probe` ContextPack sections;
- project inventory now carries bounded `sourceChunks` snippets derived only
  from scanner-safe source/test files;
- source chunks carry graph-edge backlinks when `symbolGraph` edge source refs
  land inside the chunk window, so hybrid retrieval can follow route/service
  call-chain evidence into bounded snippets;
- ContextPack can select source chunk `code_probe` sections when task terms
  match a snippet or when selected hybrid inventory evidence points to a chunk;
- lexical source chunk snippet matches now use BM25-style scoring over
  line-label-stripped `sourceChunkSearchText` terms and render the selected
  chunk's `BM25 score` for auditability;
- source chunks selected through focused inventory or graph pointers cite and
  render the pointed source lines before broad lexical lines, avoiding adjacent
  same-file route leakage inside old monolith files;
- graph/inventory pointers into a source chunk are deduplicated before
  rendering, and the source chunk section lists the real pointing inventory
  record so repeated hybrid edge paths do not create noisy duplicate evidence;
- source chunks now carry a line-label-free `contentSha256` in addition to the
  legacy snippet `sha256`, giving future cross-run source retrieval and drift
  comparison a stable bounded-content anchor when line numbers move;
- `project-inventory.json` now carries a bounded `sourceChunkIndex` manifest
  keyed by chunk `contentSha256`, path/window, source refs, and linked
  inventory record refs, so current and historical inventory evidence can
  recover source-chunk links without duplicating snippets or requiring external
  embedding/vector dependencies;
- `sourceChunkIndex` entries now also carry bounded deterministic lexical
  metadata: `lexicalTokens`, compact token-only `searchText`, and combined
  `linkedRecordRefs`. These fields are derived from the bounded chunk
  path/line-label-free content and existing linked inventory refs, keeping
  source refs, graph evidence, and bounded chunks as the authority while
  preparing the index for durable cross-run lexical retrieval;
- selected source chunk ContextPack probes now render valid `contentSha256`
  values as `Content SHA-256` audit lines, so downstream reports or RAG
  indexes can reuse the stable chunk anchor without treating it as search text;
- source chunk index vector metadata now goes through a shared runner embedding
  provider abstraction used by both inventory index generation and task-time
  catalog `q` query vectors. The default provider remains deterministic local
  hashing with no network or dependency; injected providers receive only
  bounded lexical/search text, valid compatible provider vectors are used when
  supplied, catalog vector scoring keeps query/result models compatible,
  invalid/provider failures fall back to local vectors, and exact linked-record
  catalog fallback stays ref-only without `q`, `queryEmbedding`, or
  `queryEmbeddingModel`;
- task briefs that explicitly carry a 64-character source chunk
  `contentSha256` can retrieve the matching bounded source chunk, rendered with
  a `Matched Content SHA-256` audit line while keeping source refs grounded in
  the inventory artifact and source file lines rather than the hash itself.
  This works for current-run inventory and accepted historical inventory
  knowledge artifacts without rendering raw inventory JSON as normal
  `knowledge_*` context; when both current and historical inventories match the
  same explicit hash, current-run source evidence wins and the historical
  duplicate is suppressed while historical inventory remains available as a
  fallback;
- inventory records linked from source chunks now carry reverse
  `sourceChunkRefs`, so entrypoints, symbols, graph edges, tests, hotspots, and
  capabilities can navigate directly to bounded source evidence and ContextPack
  can follow those pointers without relying on path/line overlap inference;
- static source references to scanned SQL table names now add
  `referenceSourceRefs` to table domain entities and table-backed
  `domainEntityRefs` to repository/service source chunks, so table-focused
  tasks can retrieve relevant data-layer code without sibling-domain leakage;
- schema-qualified static SQL table references now feed the same source-ref
  backed table link path when the final table segment exactly matches a
  scanned table, including bare, quoted, and SQL Server bracketed schema/table
  forms in source-like non-test files. Dynamic schema expressions, suffix-only
  identifiers, live database inspection, ORM inference, and runtime SQL
  reconstruction remain out of scope;
- governed historical inventory knowledge now has focused regression and
  default eval coverage for that same pointer path: a hybrid-selected
  historical symbol can use `sourceChunkRefs` to select a bounded source chunk
  with knowledge/source artifact refs and `Content SHA-256` audit evidence,
  without rendering raw inventory JSON;
- when a current-run inventory and accepted historical inventory contain the
  same source chunk identity but different valid `contentSha256` values,
  ContextPack emits a bounded stale calibration signal with current and
  historical inventory/source refs. Identity can come from exact chunk id,
  exact path/window, or the same path plus explicit linked inventory record refs
  such as `symbolRefs` / `graphEdgeRefs`, so the correction-drift loop can
  still compare source chunks after line windows shift without mutating
  knowledge automatically;
- raw inventory remains a foundation input and is not injected as ordinary
  context.
- default deterministic eval scenario covers the primary capability-map path,
  governed historical inventory reuse, the historical `sourceChunkRefs` source
  chunk path, explicit `contentSha256` source chunk hints, historical source
  chunk hash drift signals, and the hybrid symbol/test fallback path, including
  scanner-real `node_symbol_*` symbolGraph edge source refs and
  graph-edge-backed source chunk retrieval. It also covers the exact-line
  source-ref hybrid supplement path where capability-map evidence stays
  primary, plus the path-only same-file negative for unrelated hybrid records
  and source chunks.
- default scanner-to-context e2e eval writes a temporary old-project fixture,
  runs real `buildProjectInventory()`, then runs real `buildContextPack()` over
  the generated inventory, including scanner-generated source chunks carrying
  `graphEdgeRefs`.
- legacy scanner-to-context fixtures can now load bounded checked-in fixture
  directories under `eval/fixtures/` in addition to inline `files[]`. The
  harness resolves those directories relative to the scenario JSON, rejects
  repository-root escapes, sorts regular files deterministically, enforces file
  count and byte limits, and merges with inline files before running the real
  inventory -> ContextPack path.
- default scanner-to-context e2e coverage now also includes a more realistic
  checked-in directory-backed billing corpus with route/controller/service/
  repository/test layers, SQL schema/view/routine evidence, a sibling customer
  domain, and generated/vendor files filtered through `fixtureDir` bounds
  before the real scanner-to-ContextPack path runs.
- default scanner-to-context e2e coverage now also includes a second
  checked-in directory-backed Symfony-style commerce corpus with YAML route
  config, billing/orders/customers controller/service/repository layers, SQL
  schema/routine evidence, tests, and vendor/tmp/cache files filtered through
  `fixtureDir.excludePaths`. This is still deterministic fixture coverage, not
  a broad real-project corpus or real embedding/RAG milestone.
- the checked-in directory-backed legacy corpora now also require full
  source-RAG readiness coverage for generated source chunks: stable
  `contentSha256` values, `sourceChunkIndex` entries, and linked inventory
  record refs must be present before their scanner-to-ContextPack scenarios
  pass. This keeps broader cross-run source retrieval/RAG work anchored to
  measurable source evidence instead of route/capability evidence alone.
- ContextPack source chunk `contentSha256` and historical `sourceChunkIndex`
  tests now avoid re-reading a section after Bun's native asymmetric matcher
  mutates fields during `toMatchObject`; they copy the real `sourceRefs` array
  before matcher assertions. This restores full native `bun test` coverage for
  the source-RAG anchor path without weakening the source-ref expectations.
- default scanner-to-context e2e coverage now also includes a third
  checked-in directory-backed Rails-style commerce corpus with
  `config/routes.rb`, billing/orders/customers namespaced controller/service/
  repository layers, SQL schema/routine evidence, tests, credential-like config
  exclusion, and vendor/tmp/log files filtered through `fixtureDir.excludePaths`.
  The scenario carries graph confidence, source-RAG readiness, corpus diversity,
  and sibling-domain leakage gates so the Rails old-project path is measured at
  the same level as the CommonJS and Symfony directory corpora.
- default scanner-to-context e2e coverage now also includes a fourth
  checked-in directory-backed Django-style commerce corpus with project
  URLConf `include(...)` mounts, billing/orders/customers `urls.py` files,
  Python view/service/repository layers, SQL schema/view/routine evidence,
  tests, credential-like config exclusion, and vendor/tmp/log files filtered
  through `fixtureDir.excludePaths`. The scenario carries graph confidence,
  source-RAG readiness, corpus diversity, and sibling-domain leakage gates so
  the Django old-project path is measured alongside the CommonJS, Symfony, and
  Rails directory corpora.
- default scanner-to-context e2e coverage now also includes a fifth
  checked-in directory-backed Laravel-style commerce corpus with static
  `Route::controller(...)->prefix(...)->group(...)` route groups, billing/
  orders/customers PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, credential-like config exclusion, and
  vendor/tmp/log files filtered through `fixtureDir.excludePaths`. The
  scenario carries graph confidence, source-RAG readiness, corpus diversity,
  and sibling-domain leakage gates so the Laravel old-project path is measured
  alongside the CommonJS, Symfony, Rails, and Django directory corpora.
- default scanner-to-context e2e coverage now also includes a sixth
  checked-in directory-backed Spring-style commerce corpus with static
  annotation routes, billing/orders/customers Java controller/service/
  repository layers, SQL schema/view/routine evidence, tests,
  credential-like config exclusion, and target/vendor/log files filtered
  through `fixtureDir.excludePaths`. The scenario carries graph confidence,
  source-RAG readiness, corpus diversity, and sibling-domain leakage gates so
  the Spring old-project path is measured alongside the CommonJS, Symfony,
  Rails, Django, and Laravel directory corpora.
- default scanner-to-context e2e coverage now also includes a seventh
  checked-in directory-backed ASP.NET-style commerce corpus with static
  attribute routes, billing/orders/customers C# controller/service/
  repository layers, SQL schema/view/routine evidence, tests,
  credential-like config exclusion, and bin/obj/log files filtered through
  `fixtureDir.excludePaths`. The scenario carries graph confidence,
  source-RAG readiness, corpus diversity, and sibling-domain leakage gates so
  the ASP.NET old-project path is measured alongside the CommonJS, Symfony,
  Rails, Django, Laravel, and Spring directory corpora.
- default scanner-to-context e2e coverage now also includes an eighth
  checked-in directory-backed Go-style commerce corpus with static mux/http
  routes, billing/orders/customers handler/service/repository layers, SQL
  schema/view/routine evidence, tests, credential-like config exclusion, and
  vendor/tmp/log files filtered through `fixtureDir.excludePaths`. The scenario
  carries graph confidence, source-RAG readiness, corpus diversity, and
  sibling-domain leakage gates so the Go old-project path is measured
  alongside the CommonJS, Symfony, Rails, Django, Laravel, Spring, and ASP.NET
  directory corpora.
- default scanner-to-context e2e coverage now also includes a ninth checked-in
  directory-backed Struts-style commerce corpus with static Struts2
  `struts.xml` package/action mappings, Struts1 `struts-config.xml` action
  mappings, billing/orders/customers Java action/service/repository layers,
  SQL schema/view/routine evidence, tests, credential-like config exclusion,
  and target/vendor/log files filtered through `fixtureDir.excludePaths`. The
  scenario carries graph confidence, source-RAG readiness, corpus diversity,
  and sibling-domain leakage gates so the Struts old-project path is measured
  alongside the CommonJS, Symfony, Rails, Django, Laravel, Spring, ASP.NET, and
  Go directory corpora.
- default scanner-to-context e2e coverage now also includes a tenth checked-in
  directory-backed JAX-RS-style commerce corpus with static
  `@ApplicationPath`, resource class `@Path`, and method-level HTTP/path
  annotations, billing/orders/customers Java resource/service/repository
  layers, SQL schema/view/routine evidence, tests, credential-like config
  exclusion, and target/vendor/log files filtered through
  `fixtureDir.excludePaths`. The scenario carries graph confidence,
  source-RAG readiness, corpus diversity, and sibling-domain leakage gates so
  the JAX-RS old-project path is measured alongside the CommonJS, Symfony,
  Rails, Django, Laravel, Spring, ASP.NET, Go, and Struts directory corpora.
- default scanner-to-context e2e coverage now also includes an eleventh
  checked-in directory-backed WCF-style commerce corpus with static `.svc`
  `ServiceHost` directives, `ServiceContract` / `OperationContract` service
  operations, billing/orders/customers C# implementation/manager/repository
  layers, SQL schema/view/routine evidence, tests, credential-like config
  exclusion, and bin/obj/log files filtered through `fixtureDir.excludePaths`.
  The scenario carries host, contract, source-chunk, graph confidence, source
  chunk hash/index readiness, corpus diversity, and sibling-domain leakage
  gates so the WCF service-host old-project path is measured alongside the
  CommonJS, Symfony, Rails, Django, Laravel, Spring, ASP.NET, Go, Struts, and
  JAX-RS directory corpora.
- default scanner-to-context e2e coverage now also includes a twelfth
  checked-in directory-backed JAX-WS-style commerce corpus with static
  `@WebService` classes and `@WebMethod` operations, billing/orders/customers
  Java service/manager/repository layers, SQL schema/view/routine evidence,
  tests, credential-like config exclusion, and target/vendor/log files filtered
  through `fixtureDir.excludePaths`. The scenario carries SOAP operation,
  source-chunk, graph confidence, source chunk hash/index readiness, corpus
  diversity, and sibling-domain leakage gates so the Java SOAP old-project
  path is measured alongside the CommonJS, Symfony, Rails, Django, Laravel,
  Spring, ASP.NET, Go, Struts, JAX-RS, and WCF directory corpora.
- default scanner-to-context e2e coverage now also includes a thirteenth
  checked-in directory-backed ASMX-style commerce corpus with old `.asmx` host
  files plus static `[WebService]` classes and `[WebMethod]` operations,
  billing/orders/customers C# service/manager/repository layers, SQL schema/
  view/routine evidence, tests, credential-like config exclusion, and
  bin/obj/log files filtered through `fixtureDir.excludePaths`. The scenario
  carries ASMX operation, source-chunk, graph confidence, source chunk
  hash/index readiness, corpus diversity, and sibling-domain leakage gates so
  the ASP.NET SOAP old-project path is measured alongside the CommonJS,
  Symfony, Rails, Django, Laravel, Spring, ASP.NET, Go, Struts, JAX-RS, WCF,
  and JAX-WS directory corpora.
- default scanner-to-context e2e coverage now also includes a fourteenth
  checked-in directory-backed ASP.NET Web Forms commerce corpus with old
  `.aspx` Page directives, `Inherits` code-behind classes, `Page_Load` handler
  mapping, billing/orders/customers C# page/service/repository layers, SQL
  schema/view/routine evidence, tests, credential-like config exclusion, and
  bin/obj/log files filtered through `fixtureDir.excludePaths`. The scenario
  carries page-route, code-behind, domain-entity, SQL source-chunk, graph
  confidence, source-RAG readiness, corpus diversity, and sibling-domain
  leakage gates so the Web Forms page old-project path is measured alongside
  the CommonJS, Symfony, Rails, Django, Laravel, Spring, ASP.NET, Go, Struts,
  JAX-RS, WCF, JAX-WS, and ASMX directory corpora.
- default scanner-to-context e2e coverage now also includes a fifteenth
  checked-in directory-backed CodeIgniter 2/3 commerce corpus with static
  `application/config/routes.php` assignments across billing/orders/customers,
  PHP controller/service/repository layers, SQL schema/view/routine evidence,
  tests, credential-like config exclusion, and vendor/tmp/log/cache files
  filtered through `fixtureDir.excludePaths`. The scenario carries route,
  handler/source-chunk, domain-entity, SQL routine, graph confidence,
  source-RAG readiness, corpus diversity, and sibling-domain leakage gates so
  the CodeIgniter old-project path is measured alongside the CommonJS,
  Symfony, Rails, Django, Laravel, Spring, ASP.NET, Go, Struts, JAX-RS, WCF,
  JAX-WS, ASMX, and Web Forms directory corpora.
- default scanner-to-context e2e coverage now also includes a sixteenth
  checked-in directory-backed CakePHP 2/3 commerce corpus with static
  `app/Config/routes.php` `Router::connect(...)` assignments across billing,
  orders, and customers, PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, credential-like config exclusion, and
  vendor/tmp/log files filtered through `fixtureDir.excludePaths`. The
  scenario carries route, handler/source-chunk, domain-entity, SQL routine,
  graph confidence, source-RAG readiness, corpus diversity, and sibling-domain
  leakage gates so the CakePHP old-project path is measured alongside the
  CommonJS, Symfony, Rails, Django, Laravel, Spring, ASP.NET, Go, Struts,
  JAX-RS, WCF, JAX-WS, ASMX, Web Forms, and CodeIgniter directory corpora.
- default scanner-to-context e2e coverage now also includes a seventeenth
  checked-in directory-backed Yii/Yii2 commerce corpus with static
  `config/web.php` URL manager rules across billing, orders, and customers,
  PHP controller/service/repository layers, SQL schema/view/routine evidence,
  tests, credential-like config exclusion, and vendor/tmp/log files filtered
  through `fixtureDir.excludePaths`. The scenario carries route,
  handler/source-chunk, domain-entity, SQL routine, graph confidence,
  source-RAG readiness, corpus diversity, and sibling-domain leakage gates so
  the Yii old-project path is measured alongside the CommonJS, Symfony, Rails,
  Django, Laravel, Spring, ASP.NET, Go, Struts, JAX-RS, WCF, JAX-WS, ASMX,
  Web Forms, CodeIgniter, and CakePHP directory corpora.
- default scanner-to-context e2e coverage now also includes an eighteenth
  checked-in directory-backed Zend Framework 1 commerce corpus with static
  `application/configs/application.ini` router resources across billing,
  orders, and customers, PHP controller/service/repository layers, SQL
  schema/view/routine evidence, tests, credential-like config exclusion, and
  vendor/tmp/log files filtered through `fixtureDir.excludePaths`. The
  scenario carries route, handler/source-chunk, domain-entity, SQL routine,
  graph confidence, source-RAG readiness, corpus diversity, and sibling-domain
  leakage gates so the Zend old-project path is measured alongside the
  CommonJS, Symfony, Rails, Django, Laravel, Spring, ASP.NET, Go, Struts,
  JAX-RS, WCF, JAX-WS, ASMX, Web Forms, CodeIgniter, CakePHP, and Yii
  directory corpora.
- eval harness ContextPack fixtures can now declare relevant manifest-ref
  prefixes plus per-variant `irrelevantContextRatioMax` and scenario-level
  `contextQualityGates` aggregate ratio thresholds, producing a deterministic
  low-signal manifest proxy in JSON/HTML reports. The polyglot
  Flask/Django/Rails/Laravel fixture, Spring/ASP.NET/Go enterprise fixtures,
  JAX-WS/WCF/ASMX service fixtures, and Restify/Hapi/Koa/Hono scanner-to-context e2e
  fixtures now use this as the first task-focused leakage ratio gate across
  representative legacy framework variants. The same gate also covers
  JAX-RS, Spring XML MVC, old ASP.NET RouteTable, ASP.NET Web Forms,
  annotation Servlet, `web.xml` Servlet, Struts, legacy JSP, Classic ASP,
  ColdFusion, CodeIgniter, CakePHP, Symfony YAML/XML, Slim/Silex,
  Play Framework, old Next Pages API, and the baseline
  handcrafted/scanner-real/monolith legacy understanding fixtures.
- inventory task-token filtering now treats `play` and `framework` as generic
  framework/layer vocabulary, preventing a Play-specific task brief from
  selecting sibling capabilities or tests solely because they also mention the
  framework.
- scanner capability grouping now keeps fallback handler-name matching scoped
  to the entrypoint file. Generic legacy handler names such as Servlet `doGet`
  no longer cause sibling servlet methods and source chunks to attach to the
  wrong capability; cross-file handler links still require symbolGraph evidence.
- ContextPack graph-pointer source chunk matching now ignores cross-file
  shared configuration source refs when deciding whether selected inventory
  evidence points to a chunk. This prevents JAX-RS application-level
  `@ApplicationPath` evidence from pulling sibling resource chunks into an
  unrelated billing/customer/report task.
- default scanner-to-context e2e eval coverage now also includes a Spring-style
  Java monolith fixture, so route annotation -> handler method evidence and
  explicit constructed service/repository symbol-reference evidence feed
  task-focused ContextPack selection for a common old enterprise stack.
- default scanner-to-context e2e eval coverage now also includes a Spring XML
  MVC fixture, so static `SimpleUrlHandlerMapping` URL maps and static URL
  bean names feed `Controller#handleRequest` evidence, explicit
  service/repository graph edges, and task-focused ContextPack selection for
  pre-annotation Spring MVC applications.
- default scanner-to-context e2e eval coverage now also includes an ASP.NET
  C# monolith fixture, so controller attributes, `[controller]` route token
  expansion, action-method handler edges, explicit constructed
  service/repository symbol-reference evidence, and task-focused ContextPack
  selection are guarded for another common old enterprise stack.
- default scanner-to-context e2e eval coverage now also includes a WCF / .NET
  service-contract fixture, so static `[ServiceContract(...)]` /
  `[OperationContract(...)]` evidence, unique interface implementation
  resolution, explicit service/repository symbol-reference evidence, and
  task-focused ContextPack selection are guarded for old .NET service stacks.
- default scanner-to-context e2e eval coverage now also includes an ASMX /
  .NET WebService fixture, so static `[WebService(...)]` /
  `[WebMethod(...)]` operation evidence, explicit service/repository
  symbol-reference evidence, and task-focused ContextPack selection are
  guarded for older .NET SOAP-style service stacks.
- default scanner-to-context e2e eval coverage now also includes an ASP.NET
  Web Forms fixture, so static `.aspx` Page directives, `Inherits="..."`
  code-behind class evidence, `Page_Load` route-handler edges, explicit
  constructed service/repository symbol-reference evidence, and task-focused
  ContextPack selection are guarded for older ASP.NET page-based applications.
- default scanner-to-context e2e eval coverage now also includes an old
  ASP.NET MVC/Web API route-table fixture, so static `MapRoute(...)` /
  `MapHttpRoute(...)` calls with literal controller/action defaults feed
  `Controller#Action` route-handler edges, explicit constructed
  service/repository symbol-reference evidence, and task-focused ContextPack
  selection without expanding broad conventional route templates.
- default scanner-to-context e2e eval coverage now also includes a Go monolith
  fixture, so Gorilla mux/http route evidence, route -> handler edges,
  explicit constructed service/repository symbol-reference evidence, and
  task-focused ContextPack selection are guarded for a common old systems stack.
- default scanner-to-context e2e eval coverage now also includes a JAX-RS /
  Jakarta REST Java monolith fixture, so application-level
  `@ApplicationPath(...)`, class-level `@Path(...)` prefixes, method-level
  HTTP/path annotations, route -> handler edges, explicit constructed
  service/repository symbol-reference evidence, and task-focused ContextPack
  selection are guarded for another common old enterprise stack.
- default scanner-to-context e2e eval coverage now also includes a JAX-WS /
  SOAP Java service fixture, so static `@WebService(...)` plus non-excluded
  `@WebMethod(...)` operation annotations, route -> handler edges, explicit
  constructed service/repository symbol-reference evidence, and task-focused
  ContextPack selection are guarded for old SOAP service stacks.
- default scanner-to-context e2e eval coverage now also includes a Java
  Servlet monolith fixture, so static `@WebServlet(...)` url patterns,
  servlet method handlers, route -> handler edges, explicit constructed
  service/repository symbol-reference evidence, and task-focused ContextPack
  selection are guarded for older Java web applications.
- default scanner-to-context e2e eval coverage now also includes a Java
  `web.xml` Servlet monolith fixture, so static deployment descriptor mappings,
  servlet method handlers, route -> handler edges, explicit constructed
  service/repository symbol-reference evidence, and task-focused ContextPack
  selection are guarded for pre-annotation Java web applications.
- default scanner-to-context e2e eval coverage now also includes a legacy JSP
  fixture, so static `.jsp` page paths under `src/main/webapp` feed page route
  evidence, bounded source chunk evidence, attached tests, and task-focused
  ContextPack selection without leaking unrelated page/test domains.
- default scanner-to-context e2e eval coverage now also includes a Classic ASP
  fixture, so static `.asp` page paths under `web` feed page route evidence,
  bounded source chunk evidence, attached tests, and task-focused ContextPack
  selection without leaking unrelated page/test domains.
- default scanner-to-context e2e eval coverage now also includes a ColdFusion
  fixture, so static `.cfm` page paths under `wwwroot` feed page route
  evidence, bounded source chunk evidence, attached tests, and task-focused
  ContextPack selection without leaking unrelated page/test domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  CodeIgniter fixture, so static `application/config/routes.php` assignments
  feed route, controller action, explicit service/repository graph evidence,
  attached tests, and task-focused ContextPack selection without leaking
  unrelated CodeIgniter/PHP route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  CakePHP fixture, so static `Router::connect(...)` assignments feed route,
  controller action, explicit service/repository graph evidence, attached
  tests, and task-focused ContextPack selection without leaking unrelated
  CakePHP/PHP route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Yii/Yii2 fixture, so static URL manager string-map and array-style rules feed
  route, controller action, explicit service/repository graph evidence,
  attached tests, and task-focused ContextPack selection without leaking
  unrelated Yii/PHP route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Zend Framework 1 fixture, so static `application.ini` router resources feed
  route, controller action, explicit service/repository graph evidence,
  attached tests, and task-focused ContextPack selection without leaking
  unrelated Zend/PHP route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Drupal 7 fixture, so static `.module` `hook_menu()` menu items feed route,
  page callback function, explicit service/repository graph evidence, attached
  tests, and task-focused ContextPack selection without leaking unrelated
  Drupal/PHP route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Drupal 7 `drupal_get_form` fixture, so static form menu items feed route,
  literal form callback function, explicit service/repository graph evidence,
  attached tests, and task-focused ContextPack selection without leaking
  unrelated Drupal/PHP form route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  WordPress plugin fixture, so static `admin_post_*` / `wp_ajax_*` hooks feed
  route, callback function, explicit service/repository graph evidence,
  attached tests, and task-focused ContextPack selection without leaking
  sibling AJAX/customer hooks.
- default scanner-to-context e2e eval coverage now also includes a legacy
  WordPress REST plugin fixture, so static `register_rest_route(...)` calls
  feed REST route, callback function, explicit service/repository graph
  evidence, attached tests, and task-focused ContextPack selection without
  leaking sibling customer routes or dynamic REST values.
- default scanner-to-context e2e eval coverage now also includes a legacy
  WordPress class-callback fixture, so static hook/REST array callbacks feed
  route, class method, explicit service/repository graph evidence, attached
  tests, and task-focused ContextPack selection without leaking sibling
  customer routes or dynamic callback variables.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Symfony YAML fixture, so static route blocks feed route, controller action,
  explicit service/repository graph evidence, attached tests, and task-focused
  ContextPack selection without leaking unrelated Symfony/YAML route domains.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Symfony XML fixture, so static `<route>` elements feed route, controller
  action, explicit service/repository graph evidence, attached tests, and
  task-focused ContextPack selection without leaking unrelated Symfony/XML
  route domains.
- default scanner-to-context e2e eval coverage now also includes a Struts
  Java monolith fixture, so static Struts2 and Struts1 XML action mappings,
  route -> Action method edges, explicit constructed service/repository
  symbol-reference evidence, and task-focused ContextPack selection are
  guarded for older Java MVC applications.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Slim/Silex PHP fixture, so static `$app` / `$router` route calls feed route,
  `Slim:Controller@action` handler, explicit service/repository graph
  evidence, attached tests, and task-focused ContextPack selection without
  leaking unrelated PHP route/test domains or non-route receiver calls.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Sinatra Ruby fixture, so static block routes feed bounded route/source chunk
  evidence, attached tests, and task-focused ContextPack selection without
  leaking sibling customer routes, dynamic route expressions, or wildcard
  routes. Inline route blocks intentionally do not emit fake route-handler
  graph edges.
- default scanner-to-context e2e eval coverage now also includes a Play
  Framework Java fixture, so static `conf/routes` entries feed route,
  controller method, explicit service/repository graph evidence, attached
  tests, and task-focused ContextPack selection without leaking sibling Play
  route/test domains through generic framework vocabulary.
- default scanner-to-context polyglot e2e eval coverage now also includes a
  Flask/Python route -> handler -> explicitly constructed service/repository
  chain, a Rails/Ruby route -> controller action -> explicitly constructed
  service/repository chain, and a Laravel/PHP route -> controller action ->
  explicitly constructed service/repository chain, so Python, Ruby, and PHP
  old-project service evidence participate in the same source-ref backed
  ContextPack path.
- the polyglot e2e Django fixture now exercises a project-level URLConf
  static tuple include mount before the app-level route, so task-focused
  ContextPack selection uses the full mounted route with both parent and child
  URLConf source refs.
- the polyglot e2e Django fixture now uses a directly imported class-based
  `TrackShipmentView.as_view()` handler, proving scanner-real route ->
  class-based-view evidence flows into task-focused ContextPack selection.
- the polyglot e2e Laravel fixture now exercises a static
  `Route::prefix(...)->group(...)` route before controller/service/repository
  evidence, so task-focused ContextPack selection keeps the full mounted route
  while preserving route -> controller -> service graph refs.
- the polyglot e2e Laravel fixture now also includes a static
  `Route::apiResource(...)->only(["index"])` sibling route inside the same
  Customers API capability, proving scanner-real resource controller route
  evidence is available while a customer-profile task still excludes the
  unrelated index route/action source refs.
- the polyglot e2e Rails fixture now exercises a static `scope "/api/v1" do`
  route before controller/service/repository evidence, so task-focused
  ContextPack selection keeps the full mounted route with both scope and route
  source refs.
- the polyglot e2e Rails fixture now also includes a static
  `resources :reports, only: [:index]` sibling route inside the same Reports API
  capability, proving scanner-real RESTful resources route evidence is available
  while a daily-reports task still excludes the unrelated index route/action
  source refs.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Rails `match ... via:` fixture, so old static `match` routes feed route,
  controller action, explicit service/repository graph evidence, attached
  tests, and task-focused ContextPack selection without leaking sibling
  customer routes, no-`via` routes, dynamic route expressions, or wildcard
  routes.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Rails `root` fixture, so static `root to: "...#..."` and `root "...#..."`
  routes feed `GET /` or scoped root routes, controller action, explicit
  service/repository graph evidence, attached tests, and task-focused
  ContextPack selection without leaking sibling customer, redirect, dynamic,
  or raw inventory evidence.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Rails singular `resource` fixture, so static `resource :account` routes feed
  no-id RESTful entrypoints, plural controller action evidence, explicit
  service/repository graph evidence, attached tests, and task-focused
  ContextPack selection without leaking sibling customer, dynamic resource, or
  raw inventory evidence.
- default scanner-to-context e2e eval coverage now also includes a legacy
  Rails hashrocket fixture, so explicit `get "..."=> "...#..."` targets feed
  route-handler graph evidence and task-focused ContextPack selection without
  leaking sibling customer routes, no-`via` hashrocket matches, or raw
  inventory evidence.
- the scanner-to-context TypeScript e2e fixture now includes a NestJS
  controller variant, proving task-focused ContextPack selection can use
  decorator-derived route -> method evidence without selecting unrelated
  Express routes.
- default scanner-to-context e2e eval coverage now also includes a Restify
  fixture, so static `restify.createServer()` route evidence, imported
  handler/service/repository graph edges, graph-edge-backed source chunks,
  attached tests, and task-focused ContextPack selection are guarded without
  selecting sibling Restify domains or raw inventory context.
- default scanner-to-context e2e eval coverage now also includes a Hapi
  fixture, so static `Hapi.server(...)` route-object evidence, imported
  handler/service/repository graph edges, graph-edge-backed source chunks,
  attached tests, and task-focused ContextPack selection are guarded without
  selecting sibling Hapi domains or raw inventory context.
- default scanner-to-context e2e eval coverage now also includes a Koa Router
  fixture, so static `koa-router` / `@koa/router` constructor and prefix
  evidence, imported handler/service/repository graph edges,
  graph-edge-backed source chunks, attached tests, and task-focused
  ContextPack selection are guarded without selecting sibling Koa domains or
  raw inventory context.
- default scanner-to-context e2e eval coverage now also includes a Hono
  fixture, so static `Hono` constructor evidence, `.basePath(...)` prefixes,
  route declarations, route -> handler edges, explicit service/repository graph
  edges, graph-edge-backed source chunks, attached tests, and task-focused
  ContextPack selection are guarded without selecting sibling Hono domains or
  raw inventory context.
- default scanner-to-context e2e eval coverage now also includes a Fastify
  plugin fixture, so same-file static `register(plugin, { prefix })` evidence
  combines plugin mount prefixes with shorthand and object-literal plugin
  routes, route -> handler edges, explicit service/repository graph edges,
  graph-edge-backed source chunks, attached tests, and task-focused ContextPack
  selection without selecting sibling Fastify domains or raw inventory context.
- polyglot e2e fixture paths avoid case-only framework directory conflicts
  between Rails `app/*` conventions and Laravel `app/Services` /
  `app/Repositories`, keeping source-ref expectations stable on both
  case-sensitive and case-insensitive filesystems.
- default historical-inventory eval variant proves a governed inventory
  knowledge artifact can feed the same `code_probe` retrieval path without raw
  inventory JSON becoming a normal `knowledge_*` context section.
- runner-side historical inventory discovery reuses the latest prior per-run
  `project-inventory.json` artifact as `code_probe` evidence when neither the
  current invocation nor governed knowledge supplies inventory.
- capability matching now avoids encoded ids, broad same-file path text, test
  paths, hotspot paths, and source refs as primary capability match text, so
  unrelated routes in the same file do not enter ContextPack just because they
  share file-level noise.
- capability matching now also drops weaker capability matches whose task-token
  evidence is fully covered by the strongest match. This prevents incidental
  entries such as a `CLI Start` package script pointing at the Orders route file
  from joining a more specific Orders API task context.
- task-time inventory matching now filters additional framework/layer tokens
  such as `jax`, `jaxrs`, `resource`, `resources`, and `rest`, so JAX-RS task
  briefs do not select unrelated sibling `*Resource` capabilities through class
  naming conventions alone.
- the same framework/layer token filtering applies to servlet-oriented task
  briefs, so words such as `servlet` and `servlets` do not select unrelated
  servlet capabilities through class naming conventions alone.
- the same framework/layer token filtering applies to Struts-oriented task
  briefs, so words such as `struts`, `action`, and `actions` do not select
  unrelated `*Action` capabilities through class naming conventions alone.
- the same framework/layer token filtering applies to SOAP-oriented task
  briefs, so words such as `soap`, `web`, `webservice`, `webmethod`,
  `operation`, and `method` do not select unrelated SOAP capabilities through
  framework naming conventions alone.
- the same framework/layer token filtering applies to WCF-oriented task
  briefs, so words such as `wcf`, `contract`, `servicecontract`, and
  `operationcontract` do not select unrelated WCF service capabilities through
  framework naming conventions alone.
- the same framework/layer token filtering applies to ASMX-oriented task
  briefs, so words such as `asmx`, `webservice`, `webmethod`, and `web` do
  not select unrelated ASMX WebService capabilities through framework naming
  conventions alone.
- the same framework/layer token filtering applies to Web Forms-oriented task
  briefs, so words such as `asp`, `aspnet`, `webforms`, `form`, `forms`,
  `page`, and `pages` do not select unrelated page capabilities through
  framework naming conventions alone.
- the same framework/layer token filtering applies to old ASP.NET route-table
  task briefs, so words such as `route`, `routes`, `routeconfig`, and
  `webapiconfig` do not select unrelated legacy capabilities through framework
  naming conventions alone.
- the same framework/layer token filtering applies to JSP/page-oriented task
  briefs, so words such as `jsp`, `page`, `render`, and `rendering` do not
  select unrelated legacy page capabilities through framework/UI vocabulary
  alone.
- the same framework/language token filtering applies to CodeIgniter/PHP task
  briefs, so words such as `codeigniter` and `php` do not select unrelated
  legacy capabilities through framework/language vocabulary alone.
- the same framework/language token filtering applies to CakePHP/PHP task
  briefs, so words such as `cakephp` and `php` do not select unrelated legacy
  capabilities through framework/language vocabulary alone.
- the same framework/runtime token filtering applies to Classic ASP task
  briefs, so words such as `classic`, `asp`, `vbscript`, and `iis` do not
  select unrelated legacy page capabilities through framework/runtime
  vocabulary alone.
- the same framework/language token filtering applies to ColdFusion task
  briefs, so words such as `coldfusion`, `cfm`, and `cfml` do not select
  unrelated legacy page capabilities through framework/language vocabulary
  alone.
- the same framework token filtering applies to Hapi task briefs, so words
  such as `hapi` and `hapijs` do not select unrelated Hapi capabilities
  through framework vocabulary alone.
- the same framework token filtering applies to Koa task briefs, so words such
  as `koa` do not select unrelated Koa capabilities through framework
  vocabulary alone.
- the same framework token filtering applies to Hono task briefs, so words
  such as `hono` do not select unrelated Hono capabilities through framework
  vocabulary alone.
- the same framework/layer token filtering applies to Spring XML MVC task
  briefs, so words such as `bean`, `beans`, `mapping`, `mappings`, `mvc`, and
  `xml` do not select unrelated XML-mapped capabilities through framework
  naming conventions alone.
- hybrid and source-chunk fallback sections linked to a capability suppressed
  by accepted mark-wrong correction are annotated with that correction artifact
  and remain `code_probe` evidence instead of becoming standalone
  `knowledge_*` context.
- static SQL foreign-key clauses in already scanned `.sql` schema files now
  link table domain entities in both directions. The relationship is carried
  by source refs on the table records, source chunks, and `sourceChunkIndex`,
  so ContextPack can retrieve the referencing or referenced business table
  evidence without inspecting a live database, inferring ORM behavior, or
  exposing sibling data domains/raw inventory JSON.
- static SQL `FROM ... JOIN ...` statements in source-like non-test files and
  `.sql` files now link scanned table domain entities in both directions. The
  relationship is carried by source refs on the table records, source chunks,
  and `sourceChunkIndex`, so ContextPack can retrieve the directly joined
  business table/query evidence without inspecting a live database, inferring
  ORM behavior, reconstructing dynamic SQL, or exposing sibling data
  domains/raw inventory JSON.
- static `.sql` `CREATE VIEW` / `CREATE OR REPLACE VIEW` statements now emit
  source-ref backed view domain entities and link those views to scanned table
  dependencies found through static `FROM` / `JOIN` identifiers. The
  relationship is carried by source refs on view/table records, source chunks,
  and `sourceChunkIndex`, so ContextPack can retrieve the view SQL plus
  directly dependent table evidence without inspecting a live database,
  inferring ORM behavior, reconstructing dynamic SQL, or exposing sibling data
  domains/raw inventory JSON.
- static `.sql` `CREATE PROCEDURE` / `CREATE PROC` / `CREATE FUNCTION`
  statements now emit source-ref backed routine domain entities and link those
  routines to scanned table dependencies found through static `FROM`, `JOIN`,
  `UPDATE`, `INSERT INTO`, `DELETE FROM`, and `MERGE INTO` identifiers. The
  relationship is carried by source refs on routine/table records, source
  chunks, and `sourceChunkIndex`, so ContextPack can retrieve the routine SQL
  plus directly dependent table evidence without inspecting a live database,
  inferring ORM behavior, reconstructing dynamic SQL, or exposing sibling data
  domains/raw inventory JSON.

Remaining V2 decisions: real managed embedding/vector index, broader
source-chunk ranking and lifecycle, cross-run source retrieval, durable
correction feedback loops, and project-level evaluation over real legacy
systems.

## Recommended Sequencing

1. Finish V1.1 and run on real legacy projects.
2. Decide V1.2 parser strategy based on actual false negatives.
3. Add V1.3 ContextPack integration before UI correction, so agent behavior
   benefits from the map.
4. Expand V1.4 correction into durable correction-vs-scan comparison.
5. Use the scanner-to-context e2e fixture as the minimum regression gate for
   every future scanner, capability matching, or hybrid retrieval change.
6. Keep scenario-level inventory quality gates active for legacy fixtures:
   graph-bearing fixtures get conservative default confidence floors, and
   high-risk/multi-variant fixtures should declare stricter explicit floors so
   route-handler and symbol graph confidence cannot silently regress as the
   eval corpus grows.
7. Promote repeated historical inventory reuse into governed knowledge when it
   proves stable, so future tasks avoid repeated artifact lookups.
8. Add real V2 vector/RAG infrastructure only after graph and evaluation set
   expose clear gaps; keep optional provider vectors as ranking metadata, not
   source authority.
