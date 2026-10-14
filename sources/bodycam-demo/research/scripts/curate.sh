#!/bin/bash
# curate.sh REF_DIR -> writes REF_DIR/frames/ref_NN_<thema>.jpg (1280 px wide)
R=$1; O=$R/frames; mkdir -p $O; rm -f $O/ref_*.jpg; n=0
cp_(){ n=$((n+1)); f=$(printf "%s/ref_%02d_%s.jpg" $O $n $2); if [[ $1 == *.png ]]; then ffmpeg -v error -y -i $1 -q:v 2 $f; else cp $1 $f; fi; }
at(){ n=$((n+1)); f=$(printf "%s/ref_%02d_%s.jpg" $O $n $3); ffmpeg -v error -y -ss $2 -i $R/video/$1.mkv -frames:v 1 -vf scale=1280:-2 -q:v 2 $f; }
A=$R/all
cp_ $R/analysis/osd_full.png osd_spiel_tag_innen
cp_ $A/g1_house_day/0019.jpg lowready_gewehr_tag
cp_ $A/g1_house_dark/0097.jpg lowready_gewehr_schlafzimmer
cp_ $A/g1_house_dark/0103.jpg lowready_raum_leichen
at g7_reload_cmp 69.50 lowready_m4_idle
cp_ $A/g1_house_dark/0025.jpg ads_reddot_veranda
cp_ $A/g1_house_dark/0107.jpg ads_reddot_flur
cp_ $A/g1_house_dark/0109.jpg ads_reddot_treppe
cp_ $A/g1_house_dark/0138.jpg ads_reddot_kueche
cp_ $A/g1_house_day/0132.jpg ads_optik_aussen
cp_ $A/g4_house_ext/0028.jpg ads_kimme_korn_beton
for t in 69.60 70.20 70.40 70.80 71.40 71.80 72.20 72.80 73.40; do at g7_reload_cmp $t reload_normal_t$t; done
for t in 78.40 78.60 79.00 79.60 80.20 80.60 81.00; do at g7_reload_cmp $t reload_combat_t$t; done
cp_ $A/g1_house_dark/0137.jpg schuss_muendungslicht_kueche
at g2_m4_reload 48.583 schuss_auto_lichtframe
at g2_m4_reload 48.617 schuss_auto_blurframe
cp_ $A/g4_house_ext/0026.jpg schuss_feuergefecht_beton
cp_ $A/g3_dark_flash/0058.jpg taschenlampe_flur
cp_ $A/g3_dark_flash/0067.jpg taschenlampe_raum
cp_ $A/g3_dark_flash/0076.jpg taschenlampe_nah_bloom
cp_ $A/g5_night/0026.jpg taschenlampe_ads_nacht
cp_ $A/g5_night/0038.jpg taschenlampe_ads_tuer
cp_ $A/g3_dark_flash/0062.jpg kompression_makrobloecke
cp_ $A/g3_dark_flash/0081.jpg kompression_bloecke_lampe
cp_ $A/g3_dark_flash/0085.jpg schaden_rot
cp_ $A/g1_house_dark/0121.jpg nacht_aussen_veranda
cp_ $A/g1_house_dark/0126.jpg nacht_aussen_fenster_innenlicht
cp_ $A/g5_night/0015.jpg nacht_himmel_aussen
cp_ $A/g1_house_dark/0119.jpg overlay_cam_connected
cp_ $A/g1_house_dark/0130.jpg overlay_cam_disconnected_glitch
cp_ $A/g1_house_dark/0134.jpg bewegungsunschaerfe_drehung
cp_ $A/g1_house_dark/0118.jpg bewegungsunschaerfe_stark
cp_ $A/g4_house_ext/0013.jpg ueberbelichtet_fenster
cp_ $A/g1_house_day/0098.jpg innen_tag_materialien_ca
cp_ $A/g4_house_ext/0012.jpg blick_nach_unten_haende
cp_ $A/g1_house_dark/0105.jpg tuer_durchgang_waffe
cp_ $A/g1_house_day/0092.jpg pistole_ads_fassade
cp_ $A/g6_trailer/0007.jpg trailer_graben_tiefwinkel
cp_ $A/g6_trailer/0015.jpg trailer_optik_nah
cp_ $A/g6_trailer/0035.jpg trailer_innen_dunkel
cp_ $A/g4_house_ext/0033.jpg treppenhaus_weitwinkel
cp_ $A/r2_walk_night/0030.jpg echt_bodycam_nacht_halle
cp_ $A/r2_walk_night/0001.jpg echt_bodycam_fisheye_treppe
cp_ $A/r1_lowlight/0030.jpg echt_bodycam_lowlight
cp_ $A/r4_axonflex/0020.jpg echt_axonflex_buero
ls $O | wc -l
