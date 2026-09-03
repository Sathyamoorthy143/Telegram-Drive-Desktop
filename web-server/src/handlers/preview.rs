use actix_web::{web, HttpResponse, Responder};

pub async fn get_preview() -> impl Responder {
    HttpResponse::NotImplemented().body("Preview not yet implemented in web version")
}

pub async fn get_thumbnail() -> impl Responder {
    HttpResponse::NotImplemented().body("Thumbnail not yet implemented in web version")
}
