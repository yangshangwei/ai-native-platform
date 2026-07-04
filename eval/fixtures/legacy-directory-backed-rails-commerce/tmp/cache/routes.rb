Rails.application.routes.draw do
  get "/generated/noise", to: "generated#noise"
end
